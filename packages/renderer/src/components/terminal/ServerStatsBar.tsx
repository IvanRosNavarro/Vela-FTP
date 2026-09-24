import { useSyncExternalStore, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Info, TriangleAlert } from 'lucide-react';
import type { TerminalRuntime } from '../../lib/terminal/runtime';
import {
  formatLoad,
  formatPercent,
  formatRate,
  formatUptime,
  formatUsage,
  meterLevel,
  percentOf,
  type MeterLevel,
} from '../../lib/terminal/statsFormat';

const FILL: Record<MeterLevel, string> = {
  normal: 'var(--vela-accent)',
  high: 'var(--vela-warning)',
  critical: 'var(--vela-danger)',
};

/** Pista y relleno del mismo tono; el color de aviso va siempre con icono y el valor en texto. */
function Meter({ label, percent, value, title }: { label: string; percent: number; value: string; title: string }) {
  const level = meterLevel(percent);
  return (
    <span className="flex shrink-0 items-center gap-1.5" title={title}>
      <span className="text-[var(--vela-fg-muted)]">{label}</span>
      <span
        className="relative h-1.5 w-14 overflow-hidden rounded-full"
        style={{ background: 'color-mix(in srgb, var(--vela-accent) 18%, transparent)' }}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500" style={{ width: `${percent}%`, background: FILL[level] }} />
      </span>
      <span className="tabular-nums text-[var(--vela-fg)]">{value}</span>
      {level !== 'normal' && <TriangleAlert size={11} style={{ color: FILL[level] }} aria-label={level === 'critical' ? 'Crítico' : 'Alto'} />}
    </span>
  );
}

function Item({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5" title={title}>
      <span className="text-[var(--vela-fg-muted)]">{label}</span>
      <span className="flex items-center gap-1 tabular-nums text-[var(--vela-fg)]">{children}</span>
    </span>
  );
}

/**
 * Estado del servidor bajo la terminal, como en MobaXterm. Se vuelve a pintar
 * solo esta barra con cada muestra (una por segundo), no la terminal.
 */
export function ServerStatsBar({ runtime }: { runtime: TerminalRuntime }) {
  const view = useSyncExternalStore(runtime.subscribeStats, runtime.getStatsView);
  if (view.state === 'off') return null;

  const base = 'flex h-6 shrink-0 items-center gap-4 overflow-hidden whitespace-nowrap border-t border-[var(--vela-border)] px-2 text-[11px]';
  if (view.state === 'unavailable') {
    return (
      <div className={`${base} text-[var(--vela-fg-muted)]`}>
        <Info size={11} /> {view.reason}
      </div>
    );
  }
  const { stats, disk } = view;
  if (!stats) return <div className={`${base} text-[var(--vela-fg-muted)]`}>Leyendo el estado del servidor…</div>;

  const cores = stats.cores ? `${stats.cores} ${stats.cores === 1 ? 'núcleo' : 'núcleos'}` : 'núcleos desconocidos';
  const swap = stats.swapTotal > 0 ? `Swap ${formatUsage(stats.swapUsed, stats.swapTotal)}` : 'Sin swap';
  return (
    <div className={base} aria-label="Estado del servidor">
      <Meter label="CPU" percent={stats.cpu ?? 0} value={stats.cpu === null ? '…' : formatPercent(stats.cpu)} title={`CPU ocupada en el último segundo · ${cores}`} />
      <Meter
        label="RAM"
        percent={percentOf(stats.memUsed, stats.memTotal)}
        value={formatUsage(stats.memUsed, stats.memTotal)}
        title={`Memoria en uso (sin contar la caché del sistema) · ${swap}`}
      />
      {disk && (
        <Meter
          label="Disco"
          percent={percentOf(disk.used, disk.total)}
          value={formatUsage(disk.used, disk.total)}
          title={`Disco de ${disk.path} · montado en ${disk.mount} · se actualiza cada 30 s`}
        />
      )}
      <Item label="Red" title="Tráfico de todas las interfaces del servidor salvo lo">
        <ArrowDown size={10} className="text-[var(--vela-fg-muted)]" aria-label="Bajada" />
        {formatRate(stats.rxRate)}
        <ArrowUp size={10} className="ml-1 text-[var(--vela-fg-muted)]" aria-label="Subida" />
        {formatRate(stats.txRate)}
      </Item>
      <Item label="Carga" title={`Carga media de 1, 5 y 15 minutos · ${cores}`}>
        {formatLoad(stats.load)}
      </Item>
      <Item label="Encendido" title="Tiempo desde el último arranque del servidor">
        {formatUptime(stats.uptime)}
      </Item>
    </div>
  );
}
