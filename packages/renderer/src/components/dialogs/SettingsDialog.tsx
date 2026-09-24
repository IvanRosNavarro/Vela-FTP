import { useEffect, useState } from 'react';
import { Info, Keyboard, Palette, RefreshCw, Shield, SlidersHorizontal, SquareTerminal, Trash2, X } from 'lucide-react';
import { COMMAND_CATEGORY_LABELS, SETTING_DEFAULTS, type CommandInfo, type ConflictPolicy, type KnownHostInfo, type UpdateStatus } from '@vela-ftp/shared';
import { BUILTIN_THEMES } from 'vela-kit/theme';
import { formatShortcut, shortcutFromKeyEvent, toast } from 'vela-kit/ui';
import { AppError, call, errorText } from '../../lib/ipc';
import { themeManager } from '../../theme';
import { confirmDialog, useDialogStore } from '../../stores/dialogStore';
import { useSitesStore } from '../../stores/sitesStore';
import { useUiStore } from '../../stores/uiStore';
import { checkForUpdates, downloadUpdate, installUpdate } from '../../lib/updates';
import { getTerminalAppearance, setTerminalAppearance, type TerminalAppearance } from '../../lib/terminal/appearance';
import { useUpdatesStore } from '../../stores/updatesStore';
import { SyncSection } from './SyncSection';
import { Modal } from './Modal';

type Section = 'general' | 'appearance' | 'terminal' | 'shortcuts' | 'security' | 'sync' | 'about';

const SECTIONS: Array<{ id: Section; label: string; icon: typeof Palette }> = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'appearance', label: 'Apariencia', icon: Palette },
  { id: 'terminal', label: 'Terminal', icon: SquareTerminal },
  { id: 'shortcuts', label: 'Atajos', icon: Keyboard },
  { id: 'security', label: 'Seguridad', icon: Shield },
  { id: 'sync', label: 'Sincronización', icon: RefreshCw },
  { id: 'about', label: 'Acerca de', icon: Info },
];

const POLICIES: Array<{ value: ConflictPolicy; label: string }> = [
  { value: 'ask', label: 'Preguntar' },
  { value: 'overwrite-if-newer', label: 'Sobrescribir si el origen es más nuevo' },
  { value: 'overwrite', label: 'Sobrescribir siempre' },
  { value: 'resume', label: 'Reanudar' },
  { value: 'rename', label: 'Renombrar la copia nueva' },
  { value: 'skip', label: 'Saltar' },
];

const PLATFORM = window.api.platform;

function GeneralSection() {
  const [policy, setPolicy] = useState<ConflictPolicy>('ask');
  const openWith = useUiStore((s) => s.openWith);
  const [externalSave, setExternalSave] = useState<'upload' | 'ask'>('upload');
  useEffect(() => {
    void call(window.api.settings.get('transfer:conflict-policy')).then(setPolicy).catch(() => undefined);
    void call(window.api.settings.get('files:external-save')).then(setExternalSave).catch(() => undefined);
  }, []);
  const changeOpenWith = async (value: 'vela' | 'system') => {
    useUiStore.getState().setOpenWith(value);
    await call(window.api.settings.set('files:open-with', value)).catch((err) => toast(errorText(err), 'error'));
  };
  const changeExternalSave = async (value: 'upload' | 'ask') => {
    setExternalSave(value);
    await call(window.api.settings.set('files:external-save', value)).catch((err) => toast(errorText(err), 'error'));
  };
  const change = async (value: ConflictPolicy) => {
    setPolicy(value);
    await call(window.api.settings.set('transfer:conflict-policy', value)).catch((err) => toast(errorText(err), 'error'));
  };
  return (
    <div className="flex flex-col gap-4">
      <label className="vf-label">
        Si el fichero de destino ya existe
        <select className="vf-input" value={policy} onChange={(e) => void change(e.target.value as ConflictPolicy)}>
          {POLICIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-[11px] text-[var(--vela-fg-muted)]">
        Se aplica a las transferencias nuevas. Con «Preguntar», la cola espera tu decisión y puedes aplicarla a todos los conflictos a la vez.
      </p>
      <label className="vf-label">
        Espacio (ver) y F4 (editar) abren los ficheros con
        <select className="vf-input" value={openWith} onChange={(e) => void changeOpenWith(e.target.value as 'vela' | 'system')}>
          <option value="vela">El visor y el editor de Vela FTP</option>
          <option value="system">La aplicación predeterminada del sistema</option>
        </select>
      </label>
      <label className="vf-label">
        Al guardar un fichero del servidor en otra aplicación
        <select className="vf-input" value={externalSave} onChange={(e) => void changeExternalSave(e.target.value as 'upload' | 'ask')}>
          <option value="upload">Subir los cambios automáticamente</option>
          <option value="ask">Preguntar antes de subir</option>
        </select>
      </label>
      <p className="text-[11px] text-[var(--vela-fg-muted)]">
        Las dos opciones están siempre en el menú contextual. Si alguien ha cambiado el fichero en el servidor desde que lo abriste, se avisa antes de pisarlo.
      </p>
    </div>
  );
}

/** Los tres ajustes del cristal viven juntos: se guardan y se aplican a la vez. */
function GlassSection() {
  const [supported, setSupported] = useState(false);
  const [glass, setGlass] = useState({ enabled: false, intensity: 60, opacity: 60 });
  useEffect(() => {
    void call(window.api.window.backgroundMaterial()).then((r) => setSupported(r.supported)).catch(() => undefined);
    void Promise.all([
      call(window.api.settings.get('ui:glassmorphism')),
      call(window.api.settings.get('ui:glassmorphism-intensity')),
      call(window.api.settings.get('ui:glassmorphism-opacity')),
    ])
      .then(([enabled, intensity, opacity]) => setGlass({ enabled, intensity, opacity }))
      .catch(() => undefined);
  }, []);

  // Se ve al momento; si el guardado falla, se deshace para no mentir.
  const change = async (patch: Partial<typeof glass>) => {
    const previous = glass;
    const next = { ...glass, ...patch };
    setGlass(next);
    themeManager.applyGlassmorphism(next.enabled, next.intensity, next.opacity);
    const key = ([['enabled', 'ui:glassmorphism'], ['intensity', 'ui:glassmorphism-intensity'], ['opacity', 'ui:glassmorphism-opacity']] as const)
      .find(([field]) => field in patch);
    if (!key) return;
    try {
      await call(window.api.settings.set(key[1], next[key[0]]));
    } catch (err) {
      setGlass(previous);
      themeManager.applyGlassmorphism(previous.enabled, previous.intensity, previous.opacity);
      toast(`No se pudo guardar: ${errorText(err)}`, 'error');
    }
  };

  const slider = (label: string, field: 'intensity' | 'opacity', hint: string) => (
    <label className="vf-label">
      <span className="flex items-center justify-between">
        {label} <span className="tabular-nums">{glass[field]}</span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={glass[field]}
        className="w-full accent-[var(--vela-accent)]"
        onChange={(e) => void change({ [field]: Number(e.target.value) })}
      />
      <span className="text-[11px] text-[var(--vela-fg-muted)]">{hint}</span>
    </label>
  );

  return (
    <section className="flex flex-col gap-2 border-t border-[var(--vela-border)] pt-4">
      <h3 className="vf-panel-title">Efecto de cristal</h3>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={glass.enabled} onChange={(e) => void change({ enabled: e.target.checked })} />
        Fondos translúcidos con desenfoque
      </label>
      {glass.enabled && (
        <div className="flex flex-col gap-3 pt-1">
          {slider('Desenfoque', 'intensity', 'Cuánto se difumina lo que hay detrás.')}
          {slider('Opacidad', 'opacity', 'Menos opacidad, más se transparenta el fondo.')}
        </div>
      )}
      <p className="text-[11px] text-[var(--vela-fg-muted)]">
        {supported
          ? 'Tu sistema difumina de verdad lo que hay detrás de la ventana.'
          : 'Tu sistema no difumina detrás de la ventana (hace falta Windows 11 22H2 o macOS); el cristal se queda en el desenfoque de la propia interfaz.'}
      </p>
    </section>
  );
}

function AppearanceSection() {
  const [themeId, setThemeId] = useState(() => themeManager.getCurrentThemeId());
  const change = async (next: string) => {
    const previous = themeId;
    themeManager.setTheme(next);
    setThemeId(next);
    try {
      await call(window.api.settings.set('ui:theme', next));
    } catch (err) {
      themeManager.setTheme(previous);
      setThemeId(previous);
      toast(`No se pudo guardar el tema: ${errorText(err)}`, 'error');
    }
  };
  const options = [{ id: 'system', name: 'Sistema (claro u oscuro según el SO)' }, ...BUILTIN_THEMES.map((t) => ({ id: t.id, name: t.name }))];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tema">
      {options.map((t) => {
        const theme = BUILTIN_THEMES.find((b) => b.id === t.id);
        return (
          <button
            key={t.id}
            role="radio"
            aria-checked={themeId === t.id}
            onClick={() => void change(t.id)}
            className={`flex items-center gap-2 rounded-md border p-2 text-left text-xs ${
              themeId === t.id ? 'border-[var(--vela-accent)]' : 'border-[var(--vela-border)] hover:border-[var(--vela-fg-muted)]'
            }`}
          >
            <span
              className="flex h-8 w-10 shrink-0 overflow-hidden rounded border border-[var(--vela-border)]"
              style={{ background: theme?.variables['--vela-bg'] ?? 'linear-gradient(135deg, #f5f6f8 50%, #0e0f12 50%)' }}
            >
              {theme && <span className="m-auto h-2 w-5 rounded" style={{ background: theme.variables['--vela-accent'] }} />}
            </span>
            {t.name}
          </button>
        );
      })}
      </div>
      <GlassSection />
    </div>
  );
}

const SCROLLBACK_OPTIONS = [1000, 5000, 10_000, 50_000, 100_000];
const TERMINAL_KEYS: Record<keyof TerminalAppearance, 'terminal:font-size' | 'terminal:font-family' | 'terminal:scrollback'> = {
  fontSize: 'terminal:font-size',
  fontFamily: 'terminal:font-family',
  scrollback: 'terminal:scrollback',
};

function TerminalSection() {
  const [appearance, setAppearance] = useState(getTerminalAppearance);
  const [family, setFamily] = useState(appearance.fontFamily);
  const mod = PLATFORM === 'darwin' ? '⌘' : 'Ctrl';

  // Se aplica al momento a las terminales abiertas; si no se guarda, se deshace.
  const change = async <K extends keyof TerminalAppearance>(field: K, value: TerminalAppearance[K]) => {
    const previous = appearance;
    const next = { ...appearance, [field]: value };
    setAppearance(next);
    setTerminalAppearance({ [field]: value });
    try {
      await call(window.api.settings.set(TERMINAL_KEYS[field], value as never));
    } catch (err) {
      setAppearance(previous);
      setTerminalAppearance(previous);
      toast(`No se pudo guardar: ${errorText(err)}`, 'error');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <label className="vf-label">
        <span className="flex items-center justify-between">
          Tamaño de letra <span className="tabular-nums">{appearance.fontSize} px</span>
        </span>
        <input
          type="range"
          min={8}
          max={32}
          value={appearance.fontSize}
          className="w-full accent-[var(--vela-accent)]"
          onChange={(e) => void change('fontSize', Number(e.target.value))}
        />
      </label>
      <label className="vf-label">
        Tipo de letra
        <input
          className="vf-input font-mono"
          value={family}
          spellCheck={false}
          onChange={(e) => setFamily(e.target.value)}
          onBlur={() => {
            const value = family.trim() || SETTING_DEFAULTS['terminal:font-family'];
            setFamily(value);
            if (value !== appearance.fontFamily) void change('fontFamily', value);
          }}
        />
        <span className="text-[11px] text-[var(--vela-fg-muted)]">Lista CSS: se usa la primera fuente instalada en este equipo. No se sincroniza.</span>
      </label>
      <label className="vf-label">
        Historial al desplazarse hacia arriba
        <select className="vf-input" value={appearance.scrollback} onChange={(e) => void change('scrollback', Number(e.target.value))}>
          {SCROLLBACK_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n.toLocaleString('es-ES')} líneas
            </option>
          ))}
        </select>
      </label>
      <section className="flex flex-col gap-1 border-t border-[var(--vela-border)] pt-4 text-[11px] text-[var(--vela-fg-muted)]">
        <h3 className="vf-panel-title">Teclado</h3>
        <p>Con la terminal enfocada, las teclas son del servidor: Ctrl+C interrumpe, Ctrl+W borra una palabra, Ctrl+R busca en el historial.</p>
        <p>
          Siguen funcionando la paleta ({formatShortcut('Ctrl+Space', PLATFORM)}), cambiar de pestaña ({formatShortcut('Ctrl+Tab', PLATFORM)}), mostrar u ocultar la terminal (
          {formatShortcut('Ctrl+`', PLATFORM)}) y abrir otra ({formatShortcut('Ctrl+Shift+`', PLATFORM)}).
        </p>
        <p>
          Copiar: {mod}+Shift+C, o {mod}+C con texto seleccionado. Pegar: {mod}+Shift+V{PLATFORM === 'win32' ? ' o Ctrl+V' : ''}. Buscar: {mod}+Shift+F.
        </p>
      </section>
    </div>
  );
}

function ShortcutsSection() {
  const commands = useSitesStore((s) => s.commands);
  const setCommands = useSitesStore((s) => s.setCommands);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  const apply = async (commandId: string, combo: string | null) => {
    setError(null);
    try {
      setCommands(await call(window.api.commands.setShortcut(commandId, combo)));
      setCapturing(null);
    } catch (err) {
      const message = err instanceof AppError && err.details && typeof err.details === 'object' && 'message' in err.details ? String(err.details.message) : errorText(err);
      setError({ id: commandId, message });
    }
  };

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturing(null);
        return;
      }
      const combo = shortcutFromKeyEvent(e);
      if (combo) void apply(capturing, combo);
    };
    // Sin suspender, main se quedaría la pulsación de un atajo ya asignado.
    void window.api.commands.suspendShortcuts(true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      void window.api.commands.suspendShortcuts(false);
    };
  }, [capturing]);

  const byCategory = Object.entries(COMMAND_CATEGORY_LABELS)
    .map(([category, label]) => ({ label, items: commands.filter((c) => c.category === category) }))
    .filter((g) => g.items.length > 0);

  const reset = async () => {
    const ok = await confirmDialog({ title: 'Restablecer atajos', message: '¿Volver a los atajos por defecto?', confirmLabel: 'Restablecer', danger: false });
    if (ok) setCommands(await call(window.api.commands.resetShortcuts()));
  };

  const row = (c: CommandInfo) => (
    <div key={c.id} className="flex items-center gap-2 border-b border-[var(--vela-border)] py-1.5 last:border-0">
      <span className="flex-1">
        {c.title}
        {error?.id === c.id && <span className="block text-[11px] text-[var(--vela-danger)]">{error.message}</span>}
      </span>
      {capturing === c.id ? (
        <span className="rounded border border-[var(--vela-accent)] px-2 py-0.5 text-[11px] text-[var(--vela-accent)]">Pulsa la combinación… (Esc cancela)</span>
      ) : (
        <button
          className="min-w-[90px] rounded border border-[var(--vela-border)] px-2 py-0.5 text-right text-[11px] hover:border-[var(--vela-accent)] disabled:opacity-60"
          disabled={c.reserved}
          title={c.reserved ? 'Reservado: no se puede cambiar' : 'Cambiar atajo'}
          onClick={() => {
            setError(null);
            setCapturing(c.id);
          }}
        >
          {c.shortcut ? formatShortcut(c.shortcut, PLATFORM) : <span className="text-[var(--vela-fg-muted)]">Sin atajo</span>}
        </button>
      )}
      <button className="vf-icon-btn h-6 w-6" title="Quitar atajo" disabled={c.reserved || !c.shortcut} onClick={() => void apply(c.id, null)}>
        <X size={12} />
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {byCategory.map((g) => (
        <section key={g.label}>
          <h3 className="vf-panel-title mb-1">{g.label}</h3>
          {g.items.map(row)}
        </section>
      ))}
      <button className="vf-btn self-start" onClick={() => void reset()}>
        Restablecer atajos por defecto
      </button>
    </div>
  );
}

function SecuritySection() {
  const vault = useSitesStore((s) => s.vault);
  const openDialog = useDialogStore((s) => s.open);
  const [hosts, setHosts] = useState<KnownHostInfo[]>([]);

  const loadHosts = () => void call(window.api.sessions.knownHosts()).then(setHosts).catch(() => setHosts([]));
  useEffect(loadHosts, []);

  const forget = async (h: KnownHostInfo) => {
    const ok = await confirmDialog({
      title: 'Olvidar huella',
      message: `La próxima conexión a ${h.host}:${h.port} volverá a pedir confirmación.`,
      confirmLabel: 'Olvidar',
      danger: false,
    });
    if (!ok) return;
    await call(window.api.sessions.forget(h.host, h.port, h.fingerprint)).catch((err) => toast(errorText(err), 'error'));
    loadHosts();
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className="vf-panel-title">Contraseñas guardadas</h3>
        <p className="text-[11px] leading-relaxed text-[var(--vela-fg-muted)]">
          {vault?.mode === 'master-password'
            ? `Protegidas con contraseña maestra${vault.locked ? ' (bloqueadas ahora)' : ''}.`
            : vault?.mode === 'keychain'
              ? 'Cifradas con el llavero del sistema.'
              : 'Este sistema no tiene llavero: establece una contraseña maestra para guardar contraseñas.'}
        </p>
        <button className="vf-btn self-start" onClick={() => openDialog({ kind: 'masterPassword' })}>
          {vault?.mode === 'master-password' ? 'Cambiar o quitar la contraseña maestra…' : 'Establecer contraseña maestra…'}
        </button>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="vf-panel-title">Servidores de confianza</h3>
        {hosts.length === 0 ? (
          <p className="text-[11px] text-[var(--vela-fg-muted)]">Aún no has confirmado ninguna huella.</p>
        ) : (
          <div className="flex flex-col">
            {hosts.map((h) => (
              <div key={`${h.host}:${h.port}:${h.fingerprint}`} className="flex items-center gap-2 border-b border-[var(--vela-border)] py-1.5 last:border-0">
                <span className="min-w-0 flex-1">
                  <span className="block">
                    {h.host}:{h.port} <span className="text-[var(--vela-fg-muted)]">{h.fingerprint.startsWith('tls:') ? 'certificado TLS' : (h.keyType ?? 'clave SSH')}</span>
                  </span>
                  <span className="block truncate font-mono text-[10px] text-[var(--vela-fg-muted)]" title={h.fingerprint}>
                    {h.fingerprint.replace(/^tls:/, '')}
                  </span>
                </span>
                <button className="vf-icon-btn" title="Olvidar" onClick={() => void forget(h)}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function updateMessage(status: UpdateStatus): string {
  switch (status.phase) {
    case 'unsupported':
      return 'Las actualizaciones solo funcionan en la versión instalada.';
    case 'idle':
      return 'Aún no se ha comprobado si hay versiones nuevas.';
    case 'checking':
      return 'Buscando actualizaciones…';
    case 'up-to-date':
      return 'Tienes la última versión.';
    case 'available':
      return status.canInstall
        ? `Vela FTP ${status.version} está disponible.`
        : `Vela FTP ${status.version} está disponible. En macOS se instala a mano desde la página de descarga.`;
    case 'downloading':
      return `Descargando ${status.version}… ${status.percent}%`;
    case 'downloaded':
      return `Vela FTP ${status.version} está lista para instalar.`;
    case 'error':
      return `No se pudo completar: ${status.error ?? 'error desconocido'}`;
  }
}

function AboutSection() {
  const status = useUpdatesStore((s) => s.status);
  const [autoCheck, setAutoCheck] = useState(true);
  useEffect(() => {
    void call(window.api.settings.get('updates:auto-check')).then(setAutoCheck).catch(() => undefined);
  }, []);
  const toggleAutoCheck = async (value: boolean) => {
    setAutoCheck(value);
    await call(window.api.settings.set('updates:auto-check', value)).catch((err) => {
      setAutoCheck(!value);
      toast(errorText(err), 'error');
    });
  };

  const busy = status?.phase === 'checking' || status?.phase === 'downloading';
  // Tras un error de descarga se conserva la versión: el botón vuelve a ofrecerla.
  const offerDownload = !!status?.version && (status.phase === 'available' || status.phase === 'error');

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Vela FTP {__APP_VERSION__}</h3>
        <p className="text-[11px] text-[var(--vela-fg-muted)]">Cliente FTP, FTPS y SFTP. Licencia GPL-3.0.</p>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="vf-panel-title">Actualizaciones</h3>
        {status && <p className="text-xs">{updateMessage(status)}</p>}
        {status?.phase === 'downloading' && (
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--vela-border)]">
            <div className="h-full rounded-full bg-[var(--vela-accent)] transition-[width]" style={{ width: `${status.percent}%` }} />
          </div>
        )}
        {status && status.phase !== 'unsupported' && (
          <div className="flex flex-wrap gap-2">
            {status.phase === 'downloaded' ? (
              <button className="vf-btn-primary" onClick={() => void installUpdate()}>
                Reiniciar e instalar
              </button>
            ) : offerDownload ? (
              <button className="vf-btn-primary" onClick={() => downloadUpdate(status)}>
                {status.canInstall ? 'Descargar' : 'Abrir la página de descarga'}
              </button>
            ) : (
              <button className="vf-btn" disabled={busy} onClick={() => void checkForUpdates()}>
                Buscar actualizaciones
              </button>
            )}
          </div>
        )}
        <label className="mt-1 flex items-center gap-2 text-xs">
          <input type="checkbox" checked={autoCheck} onChange={(e) => void toggleAutoCheck(e.target.checked)} />
          Buscar actualizaciones automáticamente
        </label>
        <p className="text-[11px] text-[var(--vela-fg-muted)]">
          Nunca se descarga nada sin que lo pidas. Una versión descargada se instala al cerrar Vela FTP o al pulsar «Reiniciar e instalar»; lo que quede en la cola se puede reanudar después.
        </p>
      </section>
    </div>
  );
}

export function SettingsDialog({ section = 'general', onClose }: { section?: Section; onClose: () => void }) {
  const [current, setCurrent] = useState<Section>(section);
  useEffect(() => {
    void useSitesStore.getState().loadCommands();
  }, []);

  return (
    <Modal title="Ajustes" onClose={onClose} width={720}>
      <div className="flex min-h-[380px] gap-4">
        <nav className="flex w-40 shrink-0 flex-col gap-0.5" aria-label="Secciones de ajustes">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-current={current === id}
              onClick={() => setCurrent(id)}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                current === id ? 'bg-[var(--vela-sidebar-active-bg)] text-[var(--vela-fg)]' : 'text-[var(--vela-fg-muted)] hover:bg-[var(--vela-sidebar-hover-bg)]'
              }`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          {current === 'general' && <GeneralSection />}
          {current === 'appearance' && <AppearanceSection />}
          {current === 'terminal' && <TerminalSection />}
          {current === 'shortcuts' && <ShortcutsSection />}
          {current === 'security' && <SecuritySection />}
          {current === 'sync' && <SyncSection />}
          {current === 'about' && <AboutSection />}
        </div>
      </div>
    </Modal>
  );
}
