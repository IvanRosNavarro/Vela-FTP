import { FileArchive, X } from 'lucide-react';
import type { ArchivePhase } from '@vela-ftp/shared';
import { cancelArchiveOp } from '../../lib/archives';
import { formatSize } from '../../lib/format';
import { useArchiveStore } from '../../stores/archiveStore';

const PHASE_LABEL: Record<ArchivePhase, string> = {
  download: 'Bajando',
  extract: 'Extrayendo',
  compress: 'Comprimiendo',
  upload: 'Subiendo',
  server: 'Trabajando en el servidor',
};

/** Extracciones y compresiones en marcha, encima de las pestañas del panel inferior. */
export function ArchiveOps() {
  const ops = useArchiveStore((s) => s.ops);
  if (ops.length === 0) return null;
  return (
    <div className="flex flex-col border-b border-[var(--vela-border)]">
      {ops.map((op) => {
        const percent = op.total ? Math.min(100, (op.done / op.total) * 100) : null;
        const detail = op.cancelling
          ? 'Cancelando…'
          : op.phase === null
            ? 'Preparando…'
            : `${PHASE_LABEL[op.phase]}${op.total ? ` · ${formatSize(op.done)} de ${formatSize(op.total)}` : ''}`;
        return (
          <div key={op.id} className="grid grid-cols-[auto_minmax(0,1fr)_120px_auto] items-center gap-2 px-2 py-1 text-xs">
            <FileArchive size={13} className="text-[var(--vela-accent)]" />
            <span className="truncate" title={op.label}>
              {op.label}
              <span className="ml-2 text-[var(--vela-fg-muted)]">{detail}</span>
            </span>
            <span
              className="h-1.5 overflow-hidden rounded-full bg-black/20"
              role="progressbar"
              aria-label={op.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? undefined}
            >
              <span
                className={`block h-full rounded-full bg-[var(--vela-accent)] ${percent === null ? 'w-1/3 animate-pulse' : ''}`}
                style={percent === null ? undefined : { width: `${percent}%` }}
              />
            </span>
            <button className="vf-icon-btn" title="Cancelar" disabled={op.cancelling} onClick={() => void cancelArchiveOp(op.id)}>
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
