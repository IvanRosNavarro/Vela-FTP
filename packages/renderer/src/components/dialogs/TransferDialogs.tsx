import { useState } from 'react';
import type { ConflictDecision, ConflictInfo } from '@vela-ftp/shared';
import { toast } from 'vela-kit/ui';
import { formatDate, formatMode, formatSize } from '../../lib/format';
import { call, errorText } from '../../lib/ipc';
import type { DialogSpec } from '../../stores/dialogStore';
import { remotePaneKey, usePanesStore } from '../../stores/panesStore';
import { Modal } from './Modal';

const DECISIONS: Array<{ value: ConflictDecision; label: string; hint: string }> = [
  { value: 'overwrite', label: 'Sobrescribir', hint: 'Reemplaza el fichero de destino' },
  { value: 'overwrite-if-newer', label: 'Sobrescribir si es más nuevo', hint: 'Solo si el origen se modificó después' },
  { value: 'resume', label: 'Reanudar', hint: 'Continúa donde se quedó si el destino es más pequeño' },
  { value: 'rename', label: 'Renombrar', hint: 'Guarda una copia como «nombre (1)»' },
  { value: 'skip', label: 'Saltar', hint: 'Deja el destino como está' },
];

export function ConflictDialog({ info, remaining, onClose }: { info: ConflictInfo; remaining: number; onClose: () => void }) {
  const [decision, setDecision] = useState<ConflictDecision>('overwrite-if-newer');
  const [applyToAll, setApplyToAll] = useState(false);
  const target = info.direction === 'download' ? info.localPath : info.remotePath;

  const submit = async (value: ConflictDecision) => {
    try {
      await call(window.api.queue.resolveConflict(info.jobId, value, applyToAll));
    } catch (err) {
      toast(`No se pudo aplicar la decisión: ${errorText(err)}`, 'error');
    }
    onClose();
  };

  const side = (label: string, data: ConflictInfo['source']) => (
    <div className="flex-1 rounded-md bg-[var(--vela-bg)] p-2">
      <div className="vf-panel-title mb-1">{label}</div>
      <div>{formatSize(data.size)}</div>
      <div className="text-[var(--vela-fg-muted)]">{formatDate(data.modifiedAt) || 'fecha desconocida'}</div>
    </div>
  );

  return (
    <Modal
      title="El fichero ya existe"
      onClose={() => void submit('skip')}
      width={500}
      footer={
        <>
          <button className="vf-btn" onClick={() => void submit('skip')}>
            Saltar
          </button>
          <button className="vf-btn-primary" onClick={() => void submit(decision)}>
            Aplicar
          </button>
        </>
      }
    >
      <p className="mb-3 break-all font-mono">{target}</p>
      <div className="mb-3 flex gap-2">
        {side(info.direction === 'download' ? 'En el servidor (origen)' : 'En este equipo (origen)', info.source)}
        {side(info.direction === 'download' ? 'En este equipo (destino)' : 'En el servidor (destino)', info.target)}
      </div>
      <div className="flex flex-col gap-1.5">
        {DECISIONS.map((d) => (
          <label key={d.value} className="flex cursor-pointer items-start gap-2">
            <input type="radio" name="decision" checked={decision === d.value} onChange={() => setDecision(d.value)} className="mt-0.5" />
            <span>
              {d.label}
              <span className="block text-[var(--vela-fg-muted)]">{d.hint}</span>
            </span>
          </label>
        ))}
      </div>
      <label className="mt-3 flex items-center gap-2">
        <input type="checkbox" checked={applyToAll} onChange={(e) => setApplyToAll(e.target.checked)} />
        Aplicar a todos los conflictos de esta cola{remaining > 1 ? ` (${remaining} pendientes)` : ''}
      </label>
    </Modal>
  );
}

type Chmod = Extract<DialogSpec, { kind: 'chmod' }>;

const WHO = ['Propietario', 'Grupo', 'Otros'];
const WHAT = ['Lectura', 'Escritura', 'Ejecución'];

export function ChmodDialog({ spec, onClose }: { spec: Chmod; onClose: () => void }) {
  const [mode, setMode] = useState(spec.mode ?? 0o644);
  const [octal, setOctal] = useState((spec.mode ?? 0o644).toString(8).padStart(3, '0'));
  const bit = (who: number, what: number) => 1 << (8 - (who * 3 + what));

  const toggle = (who: number, what: number) => {
    const next = mode ^ bit(who, what);
    setMode(next);
    setOctal(next.toString(8).padStart(3, '0'));
  };

  const apply = async () => {
    try {
      await call(window.api.remote.chmod(spec.sessionId, spec.path, mode));
      toast(`Permisos cambiados a ${formatMode(mode)}`, 'success');
      void usePanesStore.getState().refresh(remotePaneKey(spec.sessionId));
      onClose();
    } catch (err) {
      toast(`No se pudieron cambiar los permisos: ${errorText(err)}`, 'error');
    }
  };

  return (
    <Modal
      title="Permisos"
      onClose={onClose}
      footer={
        <>
          <button className="vf-btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="vf-btn-primary" onClick={() => void apply()}>
            Aplicar
          </button>
        </>
      }
    >
      <p className="mb-3 break-all font-mono">{spec.path}</p>
      <table className="mb-3 w-full">
        <thead>
          <tr>
            <th />
            {WHAT.map((w) => (
              <th key={w} className="pb-1 text-center font-normal text-[var(--vela-fg-muted)]">
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {WHO.map((who, i) => (
            <tr key={who}>
              <td className="py-1">{who}</td>
              {WHAT.map((what, j) => (
                <td key={what} className="text-center">
                  <input type="checkbox" aria-label={`${who}: ${what}`} checked={(mode & bit(i, j)) !== 0} onChange={() => toggle(i, j)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <label className="vf-label">
        Valor numérico
        <input
          className="vf-input w-24 font-mono"
          value={octal}
          onChange={(e) => {
            const value = e.target.value.replace(/[^0-7]/g, '').slice(0, 4);
            setOctal(value);
            if (value.length >= 3) setMode(parseInt(value, 8));
          }}
        />
      </label>
      <p className="mt-2 font-mono text-[var(--vela-fg-muted)]">{formatMode(mode)}</p>
    </Modal>
  );
}
