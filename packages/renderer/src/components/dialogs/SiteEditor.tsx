import { useState } from 'react';
import { DEFAULT_PORTS, siteInputSchema, type AuthMethod, type RemoteProtocol, type Site, type SiteInput } from '@vela-ftp/shared';
import { toast } from 'vela-kit/ui';
import { call, errorText } from '../../lib/ipc';
import { useSessionsStore } from '../../stores/sessionsStore';
import { useSitesStore } from '../../stores/sitesStore';
import { Modal } from './Modal';

const PROTOCOLS: Array<{ value: RemoteProtocol; label: string }> = [
  { value: 'sftp', label: 'SFTP (SSH)' },
  { value: 'ftps', label: 'FTPS explícito (FTP sobre TLS)' },
  { value: 'ftps-implicit', label: 'FTPS implícito' },
  { value: 'ftp', label: 'FTP (sin cifrar)' },
];

const AUTH_LABELS: Record<AuthMethod, string> = {
  password: 'Contraseña',
  key: 'Clave privada',
  agent: 'Agente SSH (Pageant / ssh-agent)',
  anonymous: 'Anónimo',
};

interface FormState {
  name: string;
  protocol: RemoteProtocol;
  host: string;
  port: string;
  username: string;
  auth: AuthMethod;
  keyPath: string;
  initialRemotePath: string;
  initialLocalPath: string;
  maxConnections: string;
  notes: string;
  projectId: string;
  /** '' con `hasPassword` = no tocar. */
  password: string;
  passphrase: string;
  clearPassword: boolean;
}

function fromSite(site: Site | null, projectId: string | null): FormState {
  return {
    name: site?.name ?? '',
    protocol: site?.protocol ?? 'sftp',
    host: site?.host ?? '',
    port: String(site?.port ?? DEFAULT_PORTS.sftp),
    username: site?.username ?? '',
    auth: site?.auth ?? 'password',
    keyPath: site?.keyPath ?? '',
    initialRemotePath: site?.initialRemotePath ?? '',
    initialLocalPath: site?.initialLocalPath ?? '',
    maxConnections: String(site?.maxConnections ?? 2),
    notes: site?.notes ?? '',
    projectId: site ? (site.projectId ?? '') : (projectId ?? ''),
    password: '',
    passphrase: '',
    clearPassword: false,
  };
}

function toInput(form: FormState, site: Site | null): unknown {
  const secret = (value: string, has: boolean | undefined): string | null | undefined => {
    if (value) return value;
    return has ? undefined : null;
  };
  return {
    name: form.name,
    protocol: form.protocol,
    host: form.host,
    port: Number(form.port),
    username: form.auth === 'anonymous' ? '' : form.username,
    auth: form.auth,
    keyPath: form.auth === 'key' ? form.keyPath || null : null,
    initialRemotePath: form.initialRemotePath || null,
    initialLocalPath: form.initialLocalPath || null,
    maxConnections: Number(form.maxConnections),
    notes: form.notes,
    projectId: form.projectId || null,
    password: form.auth === 'password' ? (form.clearPassword ? null : secret(form.password, site?.hasPassword)) : null,
    passphrase: form.auth === 'key' ? secret(form.passphrase, site?.hasPassphrase) : null,
  } satisfies Record<keyof SiteInput, unknown>;
}

export function SiteEditor({ site, projectId = null, onClose }: { site: Site | null; projectId?: string | null; onClose: () => void }) {
  const projects = useSitesStore((s) => s.projects);
  const [form, setForm] = useState(() => fromSite(site, projectId));
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const parsed = siteInputSchema.safeParse(toInput(form, site));
  const issues = parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
  const isSsh = form.protocol === 'sftp';

  const changeProtocol = (protocol: RemoteProtocol) => {
    setForm((f) => {
      const portWasDefault = Number(f.port) === DEFAULT_PORTS[f.protocol];
      const auth = protocol !== 'sftp' && (f.auth === 'key' || f.auth === 'agent') ? 'password' : f.auth;
      return { ...f, protocol, auth, port: portWasDefault ? String(DEFAULT_PORTS[protocol]) : f.port };
    });
  };

  const pickKey = async () => {
    const path = await call(window.api.dialog.open({ title: 'Clave privada', directory: false })).catch(() => null);
    if (path) set('keyPath', path);
  };

  const pickLocal = async () => {
    const path = await call(window.api.dialog.open({ title: 'Carpeta local inicial', directory: true })).catch(() => null);
    if (path) set('initialLocalPath', path);
  };

  const save = async (connect: boolean) => {
    if (!parsed.success) return;
    setSaving(true);
    try {
      const saved = site ? await call(window.api.sites.update(site.id, parsed.data)) : await call(window.api.sites.create(parsed.data));
      onClose();
      if (connect) void useSessionsStore.getState().connect(saved.id);
    } catch (err) {
      toast(`No se pudo guardar el sitio: ${errorText(err)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const field = (name: keyof FormState) => issues[name] && <span className="text-[var(--vela-danger)]">{issues[name]}</span>;

  return (
    <Modal
      title={site ? `Editar ${site.name}` : 'Nuevo sitio'}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="vf-btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="vf-btn" disabled={!parsed.success || saving} onClick={() => void save(false)}>
            Guardar
          </button>
          <button className="vf-btn-primary" disabled={!parsed.success || saving} onClick={() => void save(true)}>
            Guardar y conectar
          </button>
        </>
      }
    >
      <form
        className="grid grid-cols-6 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save(true);
        }}
      >
        <label className="vf-label col-span-6">
          Nombre
          <input className="vf-input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Producción web" />
          {form.name && field('name')}
        </label>
        {projects.length > 0 && (
          <label className="vf-label col-span-6">
            Proyecto
            <select className="vf-input" value={form.projectId} onChange={(e) => set('projectId', e.target.value)}>
              <option value="">Sin proyecto</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="vf-label col-span-6">
          Protocolo
          <select className="vf-input" value={form.protocol} onChange={(e) => changeProtocol(e.target.value as RemoteProtocol)}>
            {PROTOCOLS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          {form.protocol === 'ftp' && <span className="text-[var(--vela-warning)]">FTP envía la contraseña y los ficheros sin cifrar.</span>}
        </label>
        <label className="vf-label col-span-4">
          Servidor
          <input className="vf-input" value={form.host} onChange={(e) => set('host', e.target.value.trim())} placeholder="ftp.ejemplo.com" />
          {form.host && field('host')}
        </label>
        <label className="vf-label col-span-2">
          Puerto
          <input className="vf-input" inputMode="numeric" value={form.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} />
          {field('port')}
        </label>
        <label className="vf-label col-span-6">
          Autenticación
          <select className="vf-input" value={form.auth} onChange={(e) => set('auth', e.target.value as AuthMethod)}>
            {(Object.keys(AUTH_LABELS) as AuthMethod[])
              .filter((a) => isSsh || (a !== 'key' && a !== 'agent'))
              .map((a) => (
                <option key={a} value={a}>
                  {AUTH_LABELS[a]}
                </option>
              ))}
          </select>
        </label>
        {form.auth !== 'anonymous' && (
          <label className="vf-label col-span-6">
            Usuario
            <input className="vf-input" value={form.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" />
          </label>
        )}
        {form.auth === 'password' && (
          <label className="vf-label col-span-6">
            Contraseña
            <input
              className="vf-input"
              type="password"
              value={form.password}
              disabled={form.clearPassword}
              onChange={(e) => set('password', e.target.value)}
              placeholder={site?.hasPassword ? '•••••••• (guardada; escribe para cambiarla)' : 'Se guarda cifrada en este equipo'}
              autoComplete="new-password"
            />
            {site?.hasPassword && (
              <span className="flex items-center gap-1.5">
                <input type="checkbox" checked={form.clearPassword} onChange={(e) => set('clearPassword', e.target.checked)} />
                Borrar la contraseña guardada
              </span>
            )}
          </label>
        )}
        {form.auth === 'key' && (
          <>
            <label className="vf-label col-span-6">
              Clave privada (OpenSSH o PuTTY .ppk)
              <span className="flex gap-2">
                <input className="vf-input" value={form.keyPath} onChange={(e) => set('keyPath', e.target.value)} />
                <button type="button" className="vf-btn" onClick={() => void pickKey()}>
                  Elegir…
                </button>
              </span>
              {field('keyPath')}
            </label>
            <label className="vf-label col-span-6">
              Passphrase de la clave
              <input
                className="vf-input"
                type="password"
                value={form.passphrase}
                onChange={(e) => set('passphrase', e.target.value)}
                placeholder={site?.hasPassphrase ? '•••••••• (guardada)' : 'Vacía si la clave no tiene'}
                autoComplete="new-password"
              />
            </label>
          </>
        )}
        <details className="col-span-6">
          <summary className="cursor-pointer text-[11px] text-[var(--vela-fg-muted)]">Opciones avanzadas</summary>
          <div className="mt-3 grid grid-cols-6 gap-3">
            <label className="vf-label col-span-6">
              Carpeta remota inicial
              <input className="vf-input" value={form.initialRemotePath} onChange={(e) => set('initialRemotePath', e.target.value)} placeholder="/var/www" />
              {form.initialRemotePath && field('initialRemotePath')}
            </label>
            <label className="vf-label col-span-6">
              Carpeta local inicial
              <span className="flex gap-2">
                <input className="vf-input" value={form.initialLocalPath} onChange={(e) => set('initialLocalPath', e.target.value)} />
                <button type="button" className="vf-btn" onClick={() => void pickLocal()}>
                  Elegir…
                </button>
              </span>
            </label>
            <label className="vf-label col-span-3">
              Transferencias simultáneas
              <input
                className="vf-input"
                inputMode="numeric"
                value={form.maxConnections}
                onChange={(e) => set('maxConnections', e.target.value.replace(/\D/g, ''))}
              />
              {field('maxConnections')}
            </label>
            <label className="vf-label col-span-6">
              Notas
              <textarea className="vf-input min-h-[60px]" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </label>
          </div>
        </details>
      </form>
    </Modal>
  );
}
