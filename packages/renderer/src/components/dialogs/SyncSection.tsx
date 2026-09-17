import { useEffect, useState } from 'react';
import { RefreshCw, Unlink } from 'lucide-react';
import { SYNC_CATEGORIES, type SyncCategory } from '@vela-ftp/shared';
import { toast } from 'vela-kit/ui';
import { call, errorText } from '../../lib/ipc';
import { confirmDialog } from '../../stores/dialogStore';
import { useSyncStore } from '../../stores/syncStore';

function relativeTime(at: number | null): string {
  if (!at) return 'todavía no';
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  return new Date(at).toLocaleString();
}

export function SyncSection() {
  const status = useSyncStore((s) => s.status);
  const setStatus = useSyncStore((s) => s.setStatus);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    void useSyncStore.getState().load();
  }, []);

  useEffect(() => {
    if (status?.email && !email) setEmail(status.email);
  }, [status?.email, email]);

  if (!status) return <p className="text-xs text-[var(--vela-fg-muted)]">Cargando…</p>;

  const sendLink = async () => {
    setBusy(true);
    try {
      await call(window.api.sync.requestLink(email.trim()));
      setSent(email.trim());
    } catch (err) {
      toast(`No se pudo enviar el enlace: ${errorText(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    setBusy(true);
    try {
      setStatus(await call(window.api.sync.activate(password)));
      setPassword('');
      toast('Sincronización activada', 'success');
    } catch (err) {
      toast(`No se pudo activar: ${errorText(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    try {
      setStatus(await call(window.api.sync.now()));
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    const ok = await confirmDialog({
      title: 'Desvincular este dispositivo',
      message:
        'Dejará de sincronizar. Tus sitios, proyectos y contraseñas siguen aquí y siguen en el servidor para tus otros dispositivos.',
      confirmLabel: 'Desvincular',
      danger: true,
    });
    if (!ok) return;
    await call(window.api.sync.deactivate()).catch((err) => toast(errorText(err), 'error'));
    setSent(null);
  };

  const toggleCategory = async (category: SyncCategory, enabled: boolean) => {
    const disabled = enabled ? status.disabledCategories.filter((c) => c !== category) : [...status.disabledCategories, category];
    try {
      setStatus(await call(window.api.sync.setCategories(disabled)));
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className="vf-panel-title">Sincronización</h3>
        <p className="text-[11px] leading-relaxed text-[var(--vela-fg-muted)]">
          Tus sitios, proyectos, marcadores y contraseñas viajan cifrados de extremo a extremo entre tus dispositivos, con la misma cuenta de Vela.
          El servidor solo guarda datos cifrados: la contraseña de sincronización no sale de aquí.
        </p>
      </section>

      {status.phase === 'off' && (
        <section className="flex flex-col gap-2">
          <label className="vf-label">
            Tu correo
            <input
              className="vf-input"
              type="email"
              value={email}
              placeholder="tu@correo.com"
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && email.includes('@') && void sendLink()}
            />
          </label>
          <button className="vf-btn-primary self-start" disabled={busy || !email.includes('@')} onClick={() => void sendLink()}>
            Enviar enlace de acceso
          </button>
          {sent && (
            <p className="text-[11px] text-[var(--vela-success)]">
              Enlace enviado a {sent}. Ábrelo en este mismo equipo para vincularlo.
            </p>
          )}
        </section>
      )}

      {status.phase === 'needs-password' && (
        <section className="flex flex-col gap-2">
          <p className="text-xs">Dispositivo vinculado{status.email ? ` a ${status.email}` : ''}.</p>
          <label className="vf-label">
            Contraseña de sincronización
            <input
              className="vf-input"
              type="password"
              value={password}
              autoFocus
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && password.length >= 8 && void activate()}
            />
          </label>
          <p className="text-[11px] text-[var(--vela-fg-muted)]">
            Es la que cifra tus datos, distinta de la de tu correo. Usa la misma en todos tus dispositivos: si la pierdes, nadie puede recuperar lo
            sincronizado.
          </p>
          <button className="vf-btn-primary self-start" disabled={busy || password.length < 8} onClick={() => void activate()}>
            Activar sincronización
          </button>
        </section>
      )}

      {status.phase === 'connecting' && <p className="text-xs text-[var(--vela-fg-muted)]">Conectando…</p>}

      {(status.phase === 'active' || status.phase === 'error') && (
        <>
          <section className="flex flex-col gap-1 text-xs">
            <span className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${status.connected ? 'bg-[var(--vela-success)]' : 'bg-[var(--vela-warning)]'}`} />
              {status.connected ? 'Conectado' : 'Sin conexión con el servidor'}
              {status.email && <span className="text-[var(--vela-fg-muted)]">· {status.email}</span>}
            </span>
            <span className="text-[11px] text-[var(--vela-fg-muted)]">
              Última sincronización: {relativeTime(status.lastSyncAt)}
              {status.pendingChanges > 0 && ` · ${status.pendingChanges} cambios pendientes de enviar`}
            </span>
            {status.error && <span className="text-[11px] text-[var(--vela-warning)]">{status.error}</span>}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="vf-panel-title">Qué se sincroniza</h3>
            {SYNC_CATEGORIES.map((category) => {
              const enabled = !status.disabledCategories.includes(category.id);
              return (
                <label key={category.id} className="flex items-start gap-2 text-xs">
                  <input type="checkbox" className="mt-0.5" checked={enabled} onChange={(e) => void toggleCategory(category.id, e.target.checked)} />
                  <span>
                    {category.label}
                    <span className="block text-[11px] text-[var(--vela-fg-muted)]">{category.description}</span>
                  </span>
                </label>
              );
            })}
            <p className="text-[11px] text-[var(--vela-fg-muted)]">Esta elección es de este dispositivo: los demás mantienen la suya.</p>
          </section>

          <div className="flex gap-2">
            <button className="vf-btn" disabled={busy} onClick={() => void syncNow()}>
              <RefreshCw size={12} className={busy ? 'animate-spin' : ''} /> Sincronizar ahora
            </button>
            <button className="vf-btn" onClick={() => void unlink()}>
              <Unlink size={12} /> Desvincular
            </button>
          </div>
        </>
      )}
    </div>
  );
}
