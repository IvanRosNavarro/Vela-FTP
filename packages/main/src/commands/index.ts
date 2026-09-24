import { app, BrowserWindow } from 'electron';
import { IPC_EVENTS, PALETTE_SHORTCUT, type CommandAction, type CommandCategory, type CommandInfo } from '@vela-ftp/shared';
import { CommandRegistry, ShortcutTable, createCommandDefiner, normalizeShortcutString, registerCommandShortcuts } from 'vela-kit/commands';
import { logger } from 'vela-kit/logger';
import type { SettingsRepository } from '../storage/repositories/SettingsRepository';

export interface CommandContext {
  windowId: number | null;
}

export const defineCommand = createCommandDefiner<CommandContext, CommandCategory>();

/** Ventanas con los atajos suspendidos (capturando uno nuevo en ajustes). */
export const suspendedShortcutWindows = new Set<number>();

/**
 * Ventanas con una terminal enfocada: sus teclas (Ctrl+C, Ctrl+W, Ctrl+R…) son
 * del programa remoto, salvo los comandos de TERMINAL_KEEPS.
 */
export const terminalFocusedWindows = new Set<number>();

/** Comandos cuyo atajo sigue funcionando con una terminal enfocada. */
const TERMINAL_KEEPS: ReadonlySet<string> = new Set([
  'app.commandPalette',
  'navigation.nextSession',
  'navigation.previousSession',
  'terminal.toggle',
  'terminal.new',
  'window.new',
  'window.toggleDevTools',
]);

/** true si la tecla debe llegar a la página aunque tenga un atajo de la app. */
export function shortcutPassesThrough(windowId: number, commandId: string | undefined): boolean {
  if (suspendedShortcutWindows.has(windowId)) return true;
  return terminalFocusedWindows.has(windowId) && !(commandId && TERMINAL_KEEPS.has(commandId));
}

/** Reservado para la paleta de comandos: no se puede reasignar. */
export { PALETTE_SHORTCUT } from '@vela-ftp/shared';

function sameCombo(a: string, b: string): boolean {
  try {
    return normalizeShortcutString(a) === normalizeShortcutString(b);
  } catch {
    return false;
  }
}

function windowOf(ctx: CommandContext): BrowserWindow | null {
  return ctx.windowId === null ? null : BrowserWindow.fromId(ctx.windowId);
}

/** Comando cuyo efecto es una acción de la interfaz de la ventana de origen. */
function uiCommand(id: string, title: string, category: CommandCategory, action: CommandAction, defaultShortcut?: string) {
  return defineCommand({
    id,
    title,
    category,
    ...(defaultShortcut ? { defaultShortcut } : {}),
    run: (ctx) => {
      const win = windowOf(ctx) ?? BrowserWindow.getFocusedWindow();
      win?.webContents.send(IPC_EVENTS.COMMAND_ACTION, { action });
    },
  });
}

export function buildCommandRegistry(openWindow: () => void): CommandRegistry<CommandContext, CommandCategory> {
  const registry = new CommandRegistry<CommandContext, CommandCategory>();

  registry.register(
    defineCommand({
      id: 'window.new',
      title: 'Nueva ventana',
      category: 'window',
      defaultShortcut: 'Ctrl+Shift+N',
      run: () => openWindow(),
    }),
  );

  registry.register(uiCommand('app.commandPalette', 'Paleta de comandos', 'app', 'open-palette', PALETTE_SHORTCUT));
  registry.register(uiCommand('app.settings', 'Ajustes', 'app', 'open-settings', 'Ctrl+,'));
  registry.register(uiCommand('app.checkUpdates', 'Buscar actualizaciones', 'app', 'open-updates'));
  registry.register(uiCommand('site.new', 'Nuevo sitio', 'site', 'new-site', 'Ctrl+N'));
  registry.register(uiCommand('site.newProject', 'Nuevo proyecto', 'site', 'new-project'));
  registry.register(uiCommand('site.importFileZilla', 'Importar sitios de FileZilla', 'site', 'import-filezilla'));
  registry.register(uiCommand('site.disconnect', 'Desconectar la sesión activa', 'site', 'disconnect-active', 'Ctrl+W'));
  registry.register(uiCommand('navigation.nextSession', 'Siguiente sesión', 'navigation', 'next-session', 'Ctrl+Tab'));
  registry.register(uiCommand('navigation.previousSession', 'Sesión anterior', 'navigation', 'previous-session', 'Ctrl+Shift+Tab'));
  registry.register(uiCommand('navigation.focusPath', 'Ir a la barra de ruta', 'navigation', 'focus-path', 'Ctrl+L'));
  registry.register(uiCommand('navigation.addBookmark', 'Añadir marcador de esta carpeta', 'navigation', 'add-bookmark', 'Ctrl+D'));
  registry.register(uiCommand('view.toggleHidden', 'Mostrar u ocultar ficheros ocultos', 'view', 'toggle-hidden', 'Ctrl+H'));
  registry.register(uiCommand('view.refresh', 'Refrescar los paneles', 'view', 'refresh', 'Ctrl+R'));
  registry.register(uiCommand('view.toggleBottomPanel', 'Mostrar u ocultar la cola', 'view', 'toggle-bottom-panel', 'Ctrl+J'));
  // Mismos atajos que FileZilla.
  registry.register(uiCommand('view.toggleCompare', 'Comparar carpetas', 'view', 'toggle-compare', 'Ctrl+O'));
  registry.register(uiCommand('navigation.toggleSyncBrowsing', 'Navegación sincronizada', 'navigation', 'toggle-sync-browsing', 'Ctrl+Y'));
  // Ctrl+` como en VS Code; con la terminal enfocada ese NUL no le hace falta a nadie.
  registry.register(uiCommand('terminal.toggle', 'Mostrar u ocultar la terminal', 'terminal', 'toggle-terminal', 'Ctrl+`'));
  registry.register(uiCommand('terminal.new', 'Nueva terminal SSH', 'terminal', 'new-terminal', 'Ctrl+Shift+`'));
  registry.register(uiCommand('transfer.cancelAll', 'Cancelar todas las transferencias', 'transfer', 'cancel-all'));
  registry.register(uiCommand('transfer.retryFailed', 'Reintentar las transferencias fallidas', 'transfer', 'retry-failed'));

  // Sin menú nativo no hay otra forma de abrir DevTools.
  if (!app.isPackaged) {
    registry.register(
      defineCommand({
        id: 'window.toggleDevTools',
        title: 'Herramientas de desarrollo',
        category: 'window',
        defaultShortcut: 'F12',
        run: (ctx) => windowOf(ctx)?.webContents.toggleDevTools(),
      }),
    );
  }
  registry.register(
    defineCommand({
      id: 'window.reload',
      title: 'Recargar la interfaz',
      category: 'window',
      defaultShortcut: 'Ctrl+Shift+R',
      run: (ctx) => windowOf(ctx)?.webContents.reload(),
    }),
  );

  return registry;
}

/**
 * Tabla de atajos construida a partir del registro y de los atajos del
 * usuario (`shortcuts:custom`). Se reconstruye en caliente al cambiarlos.
 */
export class ShortcutManager {
  private table: ShortcutTable;

  constructor(
    private readonly registry: CommandRegistry<CommandContext, CommandCategory>,
    private readonly settings: SettingsRepository,
  ) {
    this.table = this.build();
  }

  get current(): ShortcutTable {
    return this.table;
  }

  rebuild(): void {
    this.table = this.build();
  }

  private custom(): Record<string, string | null> {
    return this.settings.get('shortcuts:custom');
  }

  private build(): ShortcutTable {
    const table = new ShortcutTable();
    // La paleta se registra primero con su atajo fijo: gana cualquier conflicto
    // y el usuario no puede cambiarlo (lo impide `validate`).
    table.register(PALETTE_SHORTCUT, 'app.commandPalette', (windowId) => this.registry.execute('app.commandPalette', { windowId }));
    // Un custom antiguo para la paleta no debe duplicar su atajo.
    const custom = { ...this.custom(), 'app.commandPalette': null };
    registerCommandShortcuts(table, this.registry, {
      custom,
      buildContext: (windowId) => ({ windowId }),
      onConflict: (combo, id) => logger.warn(`[shortcuts] "${combo}" de ${id} ignorado por conflicto`),
    });
    return table;
  }

  /** Lista para la paleta y los ajustes, con el atajo efectivo de cada comando. */
  list(): CommandInfo[] {
    const custom = this.custom();
    return this.registry.list().map((cmd) => {
      const chosen = cmd.id in custom ? (custom[cmd.id] ?? null) : (cmd.defaultShortcut ?? null);
      const reserved = cmd.id === 'app.commandPalette';
      // Un atajo propio que coincida con el de la paleta queda anulado por ella.
      const effective = !reserved && chosen !== null && sameCombo(chosen, PALETTE_SHORTCUT) ? null : chosen;
      return {
        id: cmd.id,
        title: cmd.title,
        category: cmd.category,
        defaultShortcut: cmd.defaultShortcut ?? null,
        shortcut: reserved ? PALETTE_SHORTCUT : effective,
        reserved,
      };
    });
  }

  /**
   * Valida un atajo nuevo para un comando: formato correcto, no reservado y sin
   * pisar otro comando. Devuelve la forma canónica o un motivo de rechazo.
   */
  validate(commandId: string, combo: string | null): { ok: true; combo: string | null } | { ok: false; reason: string } {
    if (commandId === 'app.commandPalette') return { ok: false, reason: 'El atajo de la paleta no se puede cambiar' };
    if (!this.registry.get(commandId)) return { ok: false, reason: 'Comando desconocido' };
    if (combo === null) return { ok: true, combo: null };
    let normalized: string;
    try {
      normalized = normalizeShortcutString(combo);
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
    if (normalized === normalizeShortcutString(PALETTE_SHORTCUT)) return { ok: false, reason: 'Reservado para la paleta de comandos' };
    const taken = this.list().find(
      (c) => c.id !== commandId && c.shortcut !== null && normalizeShortcutString(c.shortcut) === normalized,
    );
    if (taken) return { ok: false, reason: `Ya lo usa «${taken.title}»` };
    return { ok: true, combo };
  }
}
