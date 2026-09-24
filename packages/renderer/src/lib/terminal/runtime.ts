import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { TerminalOutput } from '@vela-ftp/shared';
import { toast } from 'vela-kit/ui';
import { confirmDialog } from '../../stores/dialogStore';
import { useTerminalsStore, type TerminalStatus, type TerminalTab } from '../../stores/terminalsStore';
import { writeClipboardText } from '../clipboard';
import { call, errorText } from '../ipc';
import { getTerminalAppearance, onTerminalAppearance } from './appearance';
import { cdCommand, isRiskyPaste } from './shell';

// Paletas ANSI: la de xterm pierde el amarillo y el blanco sobre fondo claro.
const DARK_ANSI: ITheme = {
  black: '#1d1f21',
  red: '#ff6b6b',
  green: '#6ad8a4',
  yellow: '#f5c76a',
  blue: '#6aa8ff',
  magenta: '#d38aff',
  cyan: '#56c8d8',
  white: '#d8dce6',
  brightBlack: '#6b7280',
  brightRed: '#ff8a8a',
  brightGreen: '#8ef0bf',
  brightYellow: '#ffe08a',
  brightBlue: '#8fbcff',
  brightMagenta: '#e3a8ff',
  brightCyan: '#7fe0ec',
  brightWhite: '#ffffff',
};
const LIGHT_ANSI: ITheme = {
  black: '#1f2328',
  red: '#c62828',
  green: '#2e7d32',
  yellow: '#8a6100',
  blue: '#1f5fbf',
  magenta: '#8e24aa',
  cyan: '#00838f',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#e53935',
  brightGreen: '#388e3c',
  brightYellow: '#a87400',
  brightBlue: '#2a74e0',
  brightMagenta: '#a23fc4',
  brightCyan: '#0097a7',
  brightWhite: '#8c959f',
};

/** Luminosidad aproximada de un color CSS `#rrggbb` o `rgb()`; null si no se entiende. */
function luminance(color: string): number | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  const rgb = /^rgba?\((\d+)\D+(\d+)\D+(\d+)/i.exec(color);
  const parts = hex ? [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16)) : rgb ? rgb.slice(1, 4).map(Number) : null;
  if (!parts) return null;
  const [r, g, b] = parts as [number, number, number];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Colores del tema de Vela aplicados a xterm. */
function terminalTheme(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const background = v('--vela-bg', '#0e0f12');
  const light = (luminance(background) ?? 0) > 0.55;
  return {
    ...(light ? LIGHT_ANSI : DARK_ANSI),
    background,
    foreground: v('--vela-fg', '#e6e8ee'),
    cursor: v('--vela-accent', '#46b5a0'),
    cursorAccent: background,
    selectionBackground: light ? 'rgba(70, 120, 200, 0.28)' : 'rgba(120, 170, 255, 0.30)',
  };
}

const runtimes = new Map<string, TerminalRuntime>();

let themeObserver: MutationObserver | null = null;
/** Un cambio de tema reescribe variables en <html>: se repinta cada terminal. */
function watchTheme(): void {
  if (themeObserver) return;
  let scheduled = false;
  themeObserver = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const theme = terminalTheme();
      for (const runtime of runtimes.values()) runtime.term.options.theme = theme;
    });
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
  onTerminalAppearance(({ fontSize, fontFamily, scrollback }) => {
    for (const runtime of runtimes.values()) {
      runtime.term.options.fontSize = fontSize;
      runtime.term.options.fontFamily = fontFamily;
      runtime.term.options.scrollback = scrollback;
      runtime.refit();
    }
  });
}

const isMac = () => window.api.platform === 'darwin';

/** Silencio del servidor tras el que se da por pintado el prompt. */
const PENDING_INPUT_QUIET_MS = 250;

/**
 * Una terminal viva: el xterm, su conexión con el motor y el elemento que se
 * mueve entre el panel y la pestaña sin perder el contenido.
 */
export class TerminalRuntime {
  readonly term: Terminal;
  readonly search = new SearchAddon();
  private readonly fit = new FitAddon();
  private readonly element = document.createElement('div');
  private readonly resizeObserver: ResizeObserver;
  private opened = false;
  private backendId: string | null = null;
  private unlisten: (() => void) | null = null;
  private status: TerminalStatus = 'connecting';
  private connecting = false;
  private focused = false;
  private disposed = false;
  /** Orden pendiente (ir a una carpeta) hasta que el shell dé señales de vida. */
  private pendingInput: string | null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  /** Lo pone la vista: Ctrl+Shift+F abre su buscador. */
  onSearchRequest: (() => void) | null = null;

  constructor(
    readonly id: string,
    private readonly sessionId: string,
    initialCwd: string | null,
  ) {
    this.pendingInput = initialCwd ? cdCommand(initialCwd) : null;
    const { fontSize, fontFamily, scrollback } = getTerminalAppearance();
    this.term = new Terminal({
      fontSize,
      fontFamily,
      scrollback,
      theme: terminalTheme(),
      cursorBlink: true,
      macOptionIsMeta: true,
    });
    this.term.loadAddon(this.fit);
    this.term.loadAddon(this.search);
    this.term.loadAddon(new WebLinksAddon((_event, uri) => void this.openLink(uri)));
    this.term.onData((data) => this.input(data));
    this.term.onBinary((data) => {
      if (this.backendId) window.api.terminal.writeBinary(this.backendId, data);
    });
    this.term.onResize(({ cols, rows }) => {
      if (this.backendId) window.api.terminal.resize(this.backendId, cols, rows);
    });
    this.term.attachCustomKeyEventHandler((event) => this.onKey(event));

    this.element.className = 'h-full w-full';
    this.element.addEventListener('focusin', () => this.setFocused(true));
    this.element.addEventListener('focusout', () => this.setFocused(false));
    // En captura: antes de que xterm meta el texto (pegado con el ratón, menú…).
    this.element.addEventListener('paste', (event) => this.onNativePaste(event), true);
    this.resizeObserver = new ResizeObserver(() => this.refit());
    this.resizeObserver.observe(this.element);
  }

  /** Pone la terminal dentro de `container`; la primera vez abre xterm y conecta. */
  attach(container: HTMLElement): void {
    container.appendChild(this.element);
    if (!this.opened) {
      this.term.open(this.element);
      this.opened = true;
    }
    this.refit();
    if (!this.backendId && this.status === 'connecting') void this.connect();
  }

  detach(container: HTMLElement): void {
    if (this.element.parentElement === container) container.removeChild(this.element);
    this.setFocused(false);
  }

  refit(): void {
    if (!this.opened || !this.element.isConnected || this.element.clientWidth === 0 || this.element.clientHeight === 0) return;
    try {
      this.fit.fit();
    } catch {
      // Sin medidas todavía (fuentes cargando): el siguiente cambio de tamaño lo arregla.
    }
  }

  focus(): void {
    this.term.focus();
  }

  get isOpen(): boolean {
    return this.backendId !== null;
  }

  /** Escribe una orden como si la tecleara el usuario. */
  type(text: string): void {
    if (this.backendId) window.api.terminal.write(this.backendId, text);
    this.focus();
  }

  goTo(path: string): void {
    this.type(cdCommand(path));
  }

  copySelection(): void {
    if (this.term.hasSelection()) writeClipboardText(this.term.getSelection());
  }

  async pasteFromClipboard(): Promise<void> {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      toast('No se pudo leer el portapapeles', 'error');
      return;
    }
    await this.paste(text);
  }

  clear(): void {
    this.term.clear();
    this.focus();
  }

  private setStatus(status: TerminalStatus): void {
    this.status = status;
    useTerminalsStore.getState().setStatus(this.id, status);
  }

  private async connect(): Promise<void> {
    if (this.connecting || this.disposed) return;
    this.connecting = true;
    this.setStatus('connecting');
    try {
      const { terminalId } = await call(window.api.terminal.open(this.sessionId, this.term.cols, this.term.rows));
      if (this.disposed) {
        window.api.terminal.close(terminalId);
        return;
      }
      this.backendId = terminalId;
      this.setStatus('open');
      this.unlisten = window.api.terminal.listen(terminalId, (message) => this.onOutput(message));
    } catch (err) {
      this.term.write(`\x1b[31mNo se pudo abrir la terminal: ${errorText(err)}\x1b[0m\r\n\x1b[2mIntro para reintentar\x1b[0m\r\n`);
      this.setStatus('closed');
    } finally {
      this.connecting = false;
    }
  }

  private onOutput(message: TerminalOutput): void {
    if (message.t === 'data') {
      this.term.write(message.data);
      if (this.pendingInput) this.schedulePendingInput();
      return;
    }
    this.release();
    const reason = message.t === 'exit' ? 'Sesión terminada' : message.message;
    this.term.write(`\r\n\x1b[2m[${reason}] Intro para abrir otra\x1b[0m\r\n`);
    this.setStatus('closed');
  }

  /**
   * La orden pendiente sale cuando el servidor deja de escribir (bienvenida y
   * prompt pintados); antes, el eco del tty la duplicaría en pantalla.
   */
  private schedulePendingInput(): void {
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      if (!this.pendingInput || !this.backendId) return;
      window.api.terminal.write(this.backendId, this.pendingInput);
      this.pendingInput = null;
    }, PENDING_INPUT_QUIET_MS);
  }

  private input(data: string): void {
    if (this.backendId) {
      window.api.terminal.write(this.backendId, data);
      return;
    }
    if (this.status === 'closed' && data === '\r') void this.connect();
  }

  /** false = xterm no procesa la tecla. Copiar y pegar como en Windows Terminal. */
  private onKey(event: KeyboardEvent): boolean {
    if (event.type !== 'keydown' || event.altKey) return true;
    const mod = isMac() ? event.metaKey : event.ctrlKey;
    if (!mod) return true;
    const key = event.key.toLowerCase();
    if (key === 'c' && (event.shiftKey || isMac() || this.term.hasSelection())) {
      event.preventDefault();
      this.copySelection();
      if (!event.shiftKey && !isMac()) this.term.clearSelection();
      return false;
    }
    // Ctrl+V solo en Windows: en Linux es «insertar literal» del shell.
    if (key === 'v' && (event.shiftKey || isMac() || window.api.platform === 'win32')) {
      event.preventDefault();
      void this.pasteFromClipboard();
      return false;
    }
    if (key === 'f' && event.shiftKey) {
      event.preventDefault();
      this.onSearchRequest?.();
      return false;
    }
    return true;
  }

  private onNativePaste(event: ClipboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
    void this.paste(event.clipboardData?.getData('text/plain') ?? '');
  }

  /** Pegar varias líneas sin modo seguro las ejecuta una a una: se pregunta antes. */
  private async paste(text: string): Promise<void> {
    if (!text || !this.backendId) return;
    if (isRiskyPaste(text, this.term.modes.bracketedPasteMode)) {
      const lines = text.replace(/[\r\n]+$/, '').split(/\r\n|\r|\n/).length;
      const ok = await confirmDialog({
        title: 'Pegar varias líneas',
        message: `Vas a pegar ${lines} líneas. El servidor ejecutará cada una en cuanto llegue.`,
        confirmLabel: 'Pegar',
        danger: true,
      });
      if (!ok) {
        this.focus();
        return;
      }
    }
    this.term.paste(text);
    this.focus();
  }

  private async openLink(url: string): Promise<void> {
    const ok = await confirmDialog({
      title: 'Abrir enlace',
      message: `¿Abrir ${url} en el navegador?`,
      confirmLabel: 'Abrir',
      danger: false,
    });
    if (!ok) return;
    try {
      await call(window.api.terminal.openLink(url));
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }

  private setFocused(focused: boolean): void {
    if (this.focused === focused) return;
    this.focused = focused;
    void window.api.terminal.setFocused(focused);
  }

  private release(): void {
    this.unlisten?.();
    this.unlisten = null;
    if (this.backendId) window.api.terminal.close(this.backendId);
    this.backendId = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.release();
    this.setFocused(false);
    this.resizeObserver.disconnect();
    this.term.dispose();
    this.element.remove();
    runtimes.delete(this.id);
  }
}

export function ensureRuntime(tab: TerminalTab): TerminalRuntime {
  watchTheme();
  let runtime = runtimes.get(tab.id);
  if (!runtime) {
    runtime = new TerminalRuntime(tab.id, tab.sessionId, tab.initialCwd);
    runtimes.set(tab.id, runtime);
  }
  return runtime;
}

export function getRuntime(id: string): TerminalRuntime | undefined {
  return runtimes.get(id);
}

export function disposeRuntime(id: string): void {
  runtimes.get(id)?.dispose();
}
