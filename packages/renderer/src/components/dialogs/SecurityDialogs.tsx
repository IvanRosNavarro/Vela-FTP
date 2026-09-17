import { useState } from 'react';
import { toast } from 'vela-kit/ui';
import { AppError, call, errorText } from '../../lib/ipc';
import type { DialogSpec } from '../../stores/dialogStore';
import { useSitesStore } from '../../stores/sitesStore';
import { Modal } from './Modal';

type HostKey = Extract<DialogSpec, { kind: 'hostKey' }>;
type Unlock = Extract<DialogSpec, { kind: 'unlock' }>;

const TEXTS: Record<HostKey['reason'], { title: string; intro: string; accept: string }> = {
  HOST_KEY_UNKNOWN: {
    title: 'Servidor desconocido',
    intro: 'Es la primera vez que te conectas a este servidor. Comprueba que la huella coincide con la que te dio su administrador antes de continuar.',
    accept: 'Confiar y conectar',
  },
  HOST_KEY_MISMATCH: {
    title: '⚠ La clave del servidor ha cambiado',
    intro:
      'La clave de este servidor no coincide con la que guardaste. Puede deberse a una reinstalación del servidor… o a que alguien esté interceptando la conexión. No continúes si no sabes por qué ha cambiado.',
    accept: 'Sustituir la clave y conectar',
  },
  CERT_UNTRUSTED: {
    title: 'Certificado no válido',
    intro:
      'Ninguna autoridad de certificación reconoce el certificado de este servidor (autofirmado, caducado o de otro dominio). Solo continúa si conoces el servidor.',
    accept: 'Confiar en este certificado',
  },
};

export function HostKeyDialog({ spec, onClose }: { spec: HostKey; onClose: () => void }) {
  const text = TEXTS[spec.reason];
  const d = spec.details;
  const fingerprint = String(d['fingerprint'] ?? '');
  const [busy, setBusy] = useState(false);

  const finish = (accepted: boolean) => {
    spec.resolve(accepted);
    onClose();
  };

  const accept = async () => {
    setBusy(true);
    try {
      await call(
        window.api.sessions.trust({
          host: spec.host,
          port: spec.port,
          fingerprint,
          keyType: typeof d['keyType'] === 'string' ? d['keyType'] : null,
          replace: spec.reason !== 'HOST_KEY_UNKNOWN',
        }),
      );
      finish(true);
    } catch (err) {
      toast(`No se pudo guardar la huella: ${errorText(err)}`, 'error');
      setBusy(false);
    }
  };

  const rows: Array<[string, unknown]> =
    spec.reason === 'CERT_UNTRUSTED'
      ? [
          ['Sujeto', d['subject']],
          ['Emisor', d['issuer']],
          ['Válido hasta', d['validTo']],
          ['Motivo', d['reason']],
          ['Huella SHA-256', fingerprint.replace(/^tls:/, '')],
        ]
      : [
          ['Tipo de clave', d['keyType']],
          ['Huella', fingerprint],
          ...(spec.reason === 'HOST_KEY_MISMATCH' ? ([['Huella guardada', d['expected']]] as Array<[string, unknown]>) : []),
        ];

  return (
    <Modal
      title={text.title}
      onClose={() => finish(false)}
      width={520}
      footer={
        <>
          <button className="vf-btn-primary" onClick={() => finish(false)}>
            Cancelar
          </button>
          <button className={spec.reason === 'HOST_KEY_UNKNOWN' ? 'vf-btn' : 'vf-btn-danger'} disabled={busy || !fingerprint} onClick={() => void accept()}>
            {text.accept}
          </button>
        </>
      }
    >
      <p className="mb-3 leading-relaxed">{text.intro}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-md bg-[var(--vela-bg)] p-3">
        <dt className="text-[var(--vela-fg-muted)]">Servidor</dt>
        <dd className="font-mono">
          {spec.host}:{spec.port}
        </dd>
        {rows
          .filter(([, v]) => v !== null && v !== undefined && v !== '')
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-[var(--vela-fg-muted)]">{k}</dt>
              <dd className="break-all font-mono">{String(v)}</dd>
            </div>
          ))}
      </dl>
    </Modal>
  );
}

export function UnlockDialog({ spec, onClose }: { spec: Unlock; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = (ok: boolean) => {
    spec.resolve(ok);
    onClose();
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await call(window.api.vault.unlock(password));
      await useSitesStore.getState().loadVault();
      finish(true);
    } catch (err) {
      setError(err instanceof AppError && err.code === 'INVALID_MASTER_PASSWORD' ? 'Contraseña incorrecta' : errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Desbloquear contraseñas"
      onClose={() => finish(false)}
      footer={
        <>
          <button className="vf-btn" onClick={() => finish(false)}>
            Cancelar
          </button>
          <button className="vf-btn-primary" disabled={!password || busy} onClick={() => void submit()}>
            Desbloquear
          </button>
        </>
      }
    >
      <label className="vf-label">
        Contraseña maestra
        <input
          className="vf-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && password) void submit();
          }}
        />
      </label>
      {error && <p className="mt-2 text-[var(--vela-danger)]">{error}</p>}
    </Modal>
  );
}

export function MasterPasswordDialog({ onClose }: { onClose: () => void }) {
  const vault = useSitesStore((s) => s.vault);
  const hasMaster = vault?.mode === 'master-password';
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);

  const mismatch = next !== repeat;
  const tooShort = next.length > 0 && next.length < 8;

  const apply = async (remove: boolean) => {
    setBusy(true);
    try {
      await call(window.api.vault.setMasterPassword(hasMaster ? current : null, remove ? null : next));
      await useSitesStore.getState().loadVault();
      toast(remove ? 'Contraseña maestra quitada: se usa el llavero del sistema' : 'Contraseña maestra guardada', 'success');
      onClose();
    } catch (err) {
      toast(err instanceof AppError && err.code === 'INVALID_MASTER_PASSWORD' ? 'La contraseña actual no es correcta' : errorText(err), 'error');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Contraseña maestra"
      onClose={onClose}
      footer={
        <>
          {hasMaster && vault?.keychainAvailable && (
            <button className="vf-btn" disabled={busy || !current} onClick={() => void apply(true)}>
              Quitar
            </button>
          )}
          <button className="vf-btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="vf-btn-primary" disabled={busy || !next || mismatch || tooShort || (hasMaster && !current)} onClick={() => void apply(false)}>
            Guardar
          </button>
        </>
      }
    >
      <p className="mb-3 leading-relaxed text-[var(--vela-fg-muted)]">
        {vault?.keychainAvailable
          ? 'Las contraseñas de tus sitios ya están cifradas con el llavero del sistema. Con una contraseña maestra, además, habrá que escribirla cada vez que abras Vela FTP.'
          : 'Este sistema no tiene llavero: necesitas una contraseña maestra para guardar contraseñas de sitios.'}
      </p>
      <div className="flex flex-col gap-3">
        {hasMaster && (
          <label className="vf-label">
            Contraseña actual
            <input className="vf-input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </label>
        )}
        <label className="vf-label">
          Nueva contraseña (mínimo 8 caracteres)
          <input className="vf-input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </label>
        <label className="vf-label">
          Repítela
          <input className="vf-input" type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" />
          {repeat && mismatch && <span className="text-[var(--vela-danger)]">No coinciden</span>}
        </label>
        <p className="text-[var(--vela-warning)]">Si la olvidas, no hay forma de recuperar las contraseñas guardadas.</p>
      </div>
    </Modal>
  );
}
