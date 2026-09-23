import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowDown, ArrowUp, CircleAlert, CircleCheck, CircleX, Clock, Loader2, Radar, RotateCcw, Square, Trash2, X } from 'lucide-react';
import { List, type RowComponentProps } from 'react-window';
import type { JobSnapshot, ProtocolLogLine } from '@vela-ftp/shared';
import { toast } from 'vela-kit/ui';
import { formatEta, formatSize, formatSpeed } from '../../lib/format';
import { EXPORT_MODIFIER_LABEL } from '../../lib/gestures';
import { call, describeError, errorText } from '../../lib/ipc';
import { ACTIVE_STATUSES, FAILED_STATUSES, useQueueStore } from '../../stores/queueStore';
import { useSessionsStore } from '../../stores/sessionsStore';
import { stopWatch, useWatchStore } from '../../stores/watchStore';
import { formatDate } from '../../lib/format';
import { useContextMenu } from '../ContextMenu';

/** Prefijo de sesión de los trabajos recuperados de una ejecución anterior. */
const RESTORED = 'restored:';

type Tab = 'queue' | 'failed' | 'done' | 'watch' | 'log';

const STATUS_LABEL: Record<JobSnapshot['status'], string> = {
  queued: 'En cola',
  running: 'Transfiriendo',
  conflict: 'Esperando decisión',
  done: 'Completado',
  skipped: 'Saltado',
  failed: 'Error',
  cancelled: 'Cancelado',
  interrupted: 'Interrumpido',
};

function StatusIcon({ status }: { status: JobSnapshot['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 size={13} className="animate-spin text-[var(--vela-accent)]" />;
    case 'queued':
      return <Clock size={13} className="text-[var(--vela-fg-muted)]" />;
    case 'conflict':
      return <CircleAlert size={13} className="text-[var(--vela-warning)]" />;
    case 'done':
    case 'skipped':
      return <CircleCheck size={13} className="text-[var(--vela-success)]" />;
    default:
      return <CircleX size={13} className="text-[var(--vela-danger)]" />;
  }
}

const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

interface JobRowProps {
  jobs: JobSnapshot[];
  selected: Set<string>;
  onSelect: (id: string, additive: boolean) => void;
  onMenu: (e: React.MouseEvent, job: JobSnapshot) => void;
}

const JOB_GRID = '16px 16px minmax(0,1.2fr) minmax(0,1.5fr) 150px 110px';

function JobRow({ index, style, ariaAttributes, jobs, selected, onSelect, onMenu }: RowComponentProps<JobRowProps>) {
  const job = jobs[index]!;
  const percent = job.size && job.size > 0 && !job.isDirectory ? Math.min(100, (job.transferred / job.size) * 100) : 0;
  const from = job.direction === 'upload' ? job.localPath : job.remotePath;
  const to = job.direction === 'upload' ? job.remotePath : job.localPath;
  return (
    <div
      {...ariaAttributes}
      style={{ ...style, gridTemplateColumns: JOB_GRID }}
      className={`grid select-none items-center gap-2 px-2 text-xs ${selected.has(job.id) ? 'bg-[var(--vela-sidebar-active-bg)]' : ''}`}
      onMouseDown={(e) => onSelect(job.id, e.ctrlKey || e.metaKey)}
      onContextMenu={(e) => onMenu(e, job)}
      title={job.error ? describeError(job.error.code, job.error) : `${from} → ${to}`}
    >
      <StatusIcon status={job.status} />
      {job.direction === 'upload' ? <ArrowUp size={13} className="text-[var(--vela-fg-muted)]" /> : <ArrowDown size={13} className="text-[var(--vela-fg-muted)]" />}
      <span className="truncate">
        {basename(from)}
        {job.isDirectory && <span className="text-[var(--vela-fg-muted)]"> (carpeta)</span>}
      </span>
      <span className="truncate text-[var(--vela-fg-muted)]">{to}</span>
      <span className="flex items-center gap-2">
        {job.status === 'running' && !job.isDirectory ? (
          <>
            <span className="h-1.5 flex-1 overflow-hidden rounded bg-black/20">
              <span className="block h-full bg-[var(--vela-accent)] transition-[width]" style={{ width: `${percent}%` }} />
            </span>
            <span className="w-9 text-right tabular-nums">{Math.floor(percent)}%</span>
          </>
        ) : (
          <span className={`truncate ${job.error ? 'text-[var(--vela-danger)]' : 'text-[var(--vela-fg-muted)]'}`}>
            {job.error ? describeError(job.error.code) : STATUS_LABEL[job.status]}
          </span>
        )}
      </span>
      <span className="truncate text-right tabular-nums text-[var(--vela-fg-muted)]">
        {job.status === 'running'
          ? [formatSpeed(job.speed), job.size ? formatEta(job.size - job.transferred, job.speed) : ''].filter(Boolean).join(' · ')
          : job.isDirectory
            ? job.size !== null ? `${job.size} ficheros` : ''
            : formatSize(job.size)}
      </span>
    </div>
  );
}

function LogRow({ index, style, ariaAttributes, lines }: RowComponentProps<{ lines: ProtocolLogLine[] }>) {
  const line = lines[index]!;
  const color =
    line.level === 'error'
      ? 'text-[var(--vela-danger)]'
      : line.level === 'command'
        ? 'text-[var(--vela-accent)]'
        : line.level === 'response'
          ? 'text-[var(--vela-fg)]'
          : 'text-[var(--vela-fg-muted)]';
  const time = new Date(line.at).toLocaleTimeString('es-ES', { hour12: false });
  return (
    <div {...ariaAttributes} style={style} className={`truncate px-2 font-mono text-[11px] ${color}`} title={line.message}>
      <span className="text-[var(--vela-fg-muted)]">{time}</span> {line.level === 'command' ? '›' : line.level === 'response' ? '‹' : '·'} {line.message}
    </div>
  );
}

function WatchList() {
  const watches = useWatchStore((s) => s.watches);
  if (watches.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-[var(--vela-fg-muted)]">
        Clic derecho en una carpeta local → «Vigilar y subir cambios» para subir lo que modifiques mientras trabajas
      </div>
    );
  }
  return (
    <div className="h-full overflow-auto">
      {watches.map((w) => (
        <div key={w.id} className="flex items-center gap-2 border-b border-[var(--vela-border)] px-3 py-1.5 text-xs">
          <Radar size={13} className={w.error ? 'text-[var(--vela-warning)]' : 'text-[var(--vela-accent)]'} />
          <span className="min-w-0 flex-1">
            <span className="block truncate" title={`${w.localDir} → ${w.siteName}:${w.remoteDir}`}>
              {w.localDir} <span className="text-[var(--vela-fg-muted)]">→</span> {w.siteName}:{w.remoteDir}
            </span>
            <span className={`block truncate text-[10px] ${w.error ? 'text-[var(--vela-warning)]' : 'text-[var(--vela-fg-muted)]'}`}>
              {w.error ?? (w.uploads > 0 ? `${w.uploads} ficheros subidos · último ${formatDate(w.lastUploadAt)}` : 'Esperando cambios')}
            </span>
          </span>
          <button className="vf-btn py-1" onClick={() => stopWatch(w.id)}>
            <Square size={11} /> Parar
          </button>
        </div>
      ))}
    </div>
  );
}

export function BottomPanel({ height }: { height: number }) {
  const [tab, setTab] = useState<Tab>('queue');
  const jobsById = useQueueStore((s) => s.jobs);
  const order = useQueueStore((s) => s.order);
  const log = useQueueStore((s) => s.log);
  const clearLog = useQueueStore((s) => s.clearLog);
  const watchCount = useWatchStore((s) => s.watches.length);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [followLog, setFollowLog] = useState(true);
  const showMenu = useContextMenu((s) => s.show);
  const logListRef = useRef<{ scrollToRow: (o: { index: number; align?: 'end' }) => void } | null>(null);

  const all = useMemo(() => order.map((id) => jobsById[id]!).filter(Boolean), [order, jobsById]);
  // Las carpetas ya expandidas no aportan nada en la cola: se ven sus ficheros.
  const lists = useMemo(
    () => ({
      queue: all.filter((j) => ACTIVE_STATUSES.has(j.status)),
      failed: all.filter((j) => FAILED_STATUSES.has(j.status)),
      done: all.filter((j) => (j.status === 'done' || j.status === 'skipped') && !(j.isDirectory && j.status === 'done' && (j.size ?? 0) > 0)),
    }),
    [all],
  );

  useEffect(() => {
    if (tab === 'log' && followLog && log.length > 0) logListRef.current?.scrollToRow({ index: log.length - 1, align: 'end' });
  }, [log.length, tab, followLog]);

  const running = lists.queue.filter((j) => j.status === 'running');
  const totalSpeed = running.reduce((n, j) => n + j.speed, 0);
  const current = tab === 'log' || tab === 'watch' ? [] : lists[tab];

  /** Trabajos de una ejecución anterior: reconectar al sitio y reanudar. */
  const resumeRestored = async (ids: string[]) => {
    const bySite = new Map<string, string[]>();
    for (const id of ids) {
      const siteId = jobsById[id]?.sessionId.slice(RESTORED.length);
      if (siteId) bySite.set(siteId, [...(bySite.get(siteId) ?? []), id]);
    }
    for (const [siteId, siteJobs] of bySite) {
      const sessionId = await useSessionsStore.getState().ensureSession(siteId);
      if (!sessionId) continue;
      const created = await call(window.api.queue.resume(sessionId, siteJobs));
      if (created.length > 0) toast(`Reanudando ${created.length} transferencias`, 'info');
    }
  };

  const act = async (action: 'cancel' | 'retry' | 'remove', ids: string[]) => {
    if (ids.length === 0) return;
    try {
      if (action === 'retry') {
        const restored = ids.filter((id) => jobsById[id]?.sessionId.startsWith(RESTORED));
        await resumeRestored(restored);
        ids = ids.filter((id) => !restored.includes(id));
        if (ids.length === 0) return;
      }
      await call(window.api.queue[action](ids));
      if (action === 'remove') setSelected(new Set());
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };

  const selectedIds = () => current.filter((j) => selected.has(j.id)).map((j) => j.id);

  const onMenu = (e: React.MouseEvent, job: JobSnapshot) => {
    e.preventDefault();
    const ids = selected.has(job.id) ? selectedIds() : [job.id];
    if (!selected.has(job.id)) setSelected(new Set([job.id]));
    const jobs = ids.map((id) => jobsById[id]!).filter(Boolean);
    showMenu(e.clientX, e.clientY, [
      { label: 'Cancelar', icon: <X size={13} />, disabled: !jobs.some((j) => ACTIVE_STATUSES.has(j.status)), onSelect: () => void act('cancel', ids) },
      { label: 'Reintentar', icon: <RotateCcw size={13} />, disabled: !jobs.some((j) => FAILED_STATUSES.has(j.status) || j.status === 'skipped'), onSelect: () => void act('retry', ids) },
      { kind: 'separator' },
      { label: 'Quitar de la lista', icon: <Trash2 size={13} />, onSelect: () => void act('remove', ids) },
    ]);
  };

  const tabButton = (id: Tab, label: string, count?: number) => (
    <button
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`border-b-2 px-3 py-1.5 text-xs ${tab === id ? 'border-[var(--vela-accent)] text-[var(--vela-fg)]' : 'border-transparent text-[var(--vela-fg-muted)] hover:text-[var(--vela-fg)]'}`}
    >
      {label}
      {count !== undefined && count > 0 && <span className="ml-1.5 rounded-full bg-black/20 px-1.5 text-[10px]">{count}</span>}
    </button>
  );

  return (
    <div
      style={{ height, '--vf-glass': 'var(--vela-bg-elevated)' } as CSSProperties}
      className="vf-glass flex shrink-0 flex-col border-t border-[var(--vela-border)]"
    >
      <div className="flex items-center justify-between pr-2" role="tablist">
        <div className="flex">
          {tabButton('queue', 'Cola', lists.queue.length)}
          {tabButton('failed', 'Fallidas', lists.failed.length)}
          {tabButton('done', 'Completadas', lists.done.length)}
          {tabButton('watch', 'Vigilancia', watchCount)}
          {tabButton('log', 'Registro')}
        </div>
        <div className="flex items-center gap-1">
          {tab === 'queue' && running.length > 0 && (
            <span className="mr-2 text-[11px] tabular-nums text-[var(--vela-fg-muted)]">
              {running.length} activas · {formatSpeed(totalSpeed)}
            </span>
          )}
          {tab === 'queue' && (
            <button className="vf-btn py-1" disabled={lists.queue.length === 0} onClick={() => void act('cancel', lists.queue.map((j) => j.id))}>
              <X size={12} /> Cancelar todo
            </button>
          )}
          {tab === 'failed' && (
            <button className="vf-btn py-1" disabled={lists.failed.length === 0} onClick={() => void act('retry', lists.failed.map((j) => j.id))}>
              <RotateCcw size={12} /> Reintentar todo
            </button>
          )}
          {(tab === 'failed' || tab === 'done') && (
            <button className="vf-btn py-1" disabled={current.length === 0} onClick={() => void act('remove', current.map((j) => j.id))}>
              <Trash2 size={12} /> Vaciar
            </button>
          )}
          {tab === 'log' && (
            <>
              <label className="mr-2 flex items-center gap-1 text-[11px] text-[var(--vela-fg-muted)]">
                <input type="checkbox" checked={followLog} onChange={(e) => setFollowLog(e.target.checked)} /> Seguir
              </label>
              <button className="vf-btn py-1" onClick={clearLog}>
                <Trash2 size={12} /> Limpiar
              </button>
            </>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1" role="tabpanel">
        {tab === 'watch' ? (
          <WatchList />
        ) : tab === 'log' ? (
          log.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-[var(--vela-fg-muted)]">Sin actividad de protocolo</div>
          ) : (
            <List
              listRef={logListRef as never}
              rowComponent={LogRow}
              rowCount={log.length}
              rowHeight={18}
              rowProps={{ lines: log }}
              style={{ height: '100%' }}
            />
          )
        ) : current.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-[var(--vela-fg-muted)]">
            {tab === 'queue'
              ? `Arrastra ficheros entre los paneles o haz doble clic para transferir. Con ${EXPORT_MODIFIER_LABEL}+arrastrar los sacas a otro programa.`
              : 'Nada por aquí'}
          </div>
        ) : (
          <List
            rowComponent={JobRow}
            rowCount={current.length}
            rowHeight={24}
            rowProps={{
              jobs: current,
              selected,
              onSelect: (id, additive) =>
                setSelected((prev) => {
                  if (!additive) return new Set([id]);
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                }),
              onMenu,
            }}
            style={{ height: '100%' }}
          />
        )}
      </div>
    </div>
  );
}
