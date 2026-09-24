import { formatSize } from '../format';

/** Umbrales del medidor: a partir de aquí se avisa con color e icono. */
export const HIGH_PERCENT = 85;
export const CRITICAL_PERCENT = 95;

export type MeterLevel = 'normal' | 'high' | 'critical';

export function meterLevel(percent: number): MeterLevel {
  if (percent >= CRITICAL_PERCENT) return 'critical';
  if (percent >= HIGH_PERCENT) return 'high';
  return 'normal';
}

export function percentOf(used: number, total: number): number {
  return total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : 0;
}

export function formatPercent(percent: number): string {
  return `${Math.round(percent)} %`;
}

export function formatUsage(used: number, total: number): string {
  return `${formatSize(used)} / ${formatSize(total)}`;
}

/** Velocidad de red; 0 se enseña como tal (formatSpeed lo deja vacío). */
export function formatRate(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null) return '…';
  return bytesPerSecond < 1 ? '0 B/s' : `${formatSize(Math.round(bytesPerSecond))}/s`;
}

export function formatLoad(load: [number, number, number]): string {
  return load.map((n) => n.toFixed(2)).join(' ');
}

/** 3 d 4 h · 5 h 12 min · 12 min. */
export function formatUptime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} d ${hours % 24} h`;
  if (hours > 0) return `${hours} h ${minutes % 60} min`;
  return `${minutes} min`;
}
