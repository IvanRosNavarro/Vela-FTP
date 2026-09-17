import { KeyRound, Lock, LockOpen, Plug, Plus, Server, Settings2, Trash2, Copy, Pencil, Loader2 } from 'lucide-react';
import type { Site } from '@vela-ftp/shared';
import { toast } from 'vela-kit/ui';
import { call, errorText } from '../lib/ipc';
import { confirmDialog, useDialogStore } from '../stores/dialogStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { useSitesStore } from '../stores/sitesStore';
import { useContextMenu } from './ContextMenu';
import { ThemeSelect } from './ThemeSelect';

const PROTOCOL_LABEL: Record<Site['protocol'], string> = {
  sftp: 'SFTP',
  ftps: 'FTPS',
  'ftps-implicit': 'FTPS',
  ftp: 'FTP',
};

export function SitesSidebar({ width }: { width: number }) {
  const sites = useSitesStore((s) => s.sites);
  const vault = useSitesStore((s) => s.vault);
  const sessions = useSessionsStore((s) => s.sessions);
  const connecting = useSessionsStore((s) => s.connecting);
  const connect = useSessionsStore((s) => s.connect);
  const openDialog = useDialogStore((s) => s.open);
  const showMenu = useContextMenu((s) => s.show);

  const remove = async (site: Site) => {
    const ok = await confirmDialog({
      title: 'Borrar sitio',
      message: `¿Borrar «${site.name}» y su contraseña guardada?`,
      confirmLabel: 'Borrar',
      danger: true,
    });
    if (!ok) return;
    try {
      await call(window.api.sites.delete(site.id));
    } catch (err) {
      toast(`No se pudo borrar: ${errorText(err)}`, 'error');
    }
  };

  const duplicate = async (site: Site) => {
    try {
      await call(window.api.sites.duplicate(site.id));
    } catch (err) {
      toast(`No se pudo duplicar: ${errorText(err)}`, 'error');
    }
  };

  const lockToggle = async () => {
    if (!vault) return;
    if (vault.mode !== 'master-password') {
      openDialog({ kind: 'masterPassword' });
      return;
    }
    if (vault.locked) {
      openDialog({ kind: 'unlock', resolve: () => undefined });
      return;
    }
    await call(window.api.vault.lock()).catch((err) => toast(errorText(err), 'error'));
    toast('Contraseñas bloqueadas', 'info');
  };

  return (
    <aside id="vela-sidebar" style={{ width }} className="flex shrink-0 flex-col bg-[var(--vela-sidebar-bg)] text-[var(--vela-sidebar-fg)]">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <span className="vf-panel-title">Sitios</span>
        <button className="vf-icon-btn" title="Nuevo sitio" onClick={() => openDialog({ kind: 'siteEditor', site: null })}>
          <Plus size={15} />
        </button>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto px-1.5">
        {sites.length === 0 && (
          <li className="flex flex-col items-center gap-3 px-2 py-6 text-center text-xs text-[var(--vela-fg-muted)]">
            Aún no hay sitios.
            <button className="vf-btn-primary" onClick={() => openDialog({ kind: 'siteEditor', site: null })}>
              <Plus size={13} /> Añadir sitio
            </button>
          </li>
        )}
        {sites.map((site) => {
          const connected = sessions.some((s) => s.siteId === site.id);
          const isConnecting = connecting === site.id;
          return (
            <li key={site.id}>
              <button
                className="vela-site group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--vela-sidebar-hover-bg)]"
                title={`${site.protocol}://${site.username ? `${site.username}@` : ''}${site.host}:${site.port}\nDoble clic para conectar`}
                onDoubleClick={() => void connect(site.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void connect(site.id);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  showMenu(e.clientX, e.clientY, [
                    { label: 'Conectar', icon: <Plug size={13} />, disabled: isConnecting, onSelect: () => void connect(site.id) },
                    { kind: 'separator' },
                    { label: 'Editar…', icon: <Pencil size={13} />, onSelect: () => openDialog({ kind: 'siteEditor', site }) },
                    { label: 'Duplicar', icon: <Copy size={13} />, onSelect: () => void duplicate(site) },
                    { kind: 'separator' },
                    { label: 'Borrar', icon: <Trash2 size={13} />, danger: true, onSelect: () => void remove(site) },
                  ]);
                }}
              >
                {isConnecting ? (
                  <Loader2 size={14} className="shrink-0 animate-spin text-[var(--vela-accent)]" />
                ) : (
                  <Server size={14} className={`shrink-0 ${connected ? 'text-[var(--vela-success)]' : 'text-[var(--vela-fg-muted)]'}`} />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{site.name}</span>
                  <span className="block truncate text-[10px] text-[var(--vela-fg-muted)]">{site.host}</span>
                </span>
                <span className="rounded bg-black/10 px-1 text-[9px] text-[var(--vela-fg-muted)]">{PROTOCOL_LABEL[site.protocol]}</span>
                <Settings2
                  size={13}
                  className="shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
                  onClick={(e) => {
                    e.stopPropagation();
                    openDialog({ kind: 'siteEditor', site });
                  }}
                />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-2 border-t border-[var(--vela-border)] p-3">
        <button className="vf-btn justify-start" onClick={() => void lockToggle()}>
          {vault?.mode === 'master-password' ? (
            vault.locked ? (
              <>
                <Lock size={13} /> Contraseñas bloqueadas
              </>
            ) : (
              <>
                <LockOpen size={13} /> Bloquear contraseñas
              </>
            )
          ) : (
            <>
              <KeyRound size={13} /> Contraseña maestra…
            </>
          )}
        </button>
        <ThemeSelect />
      </div>
    </aside>
  );
}
