const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(value < 10 ? 1 : 0)} ${UNITS[unit]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  return bytesPerSecond > 0 ? `${formatSize(Math.round(bytesPerSecond))}/s` : '';
}

const dateFormat = new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' });

export function formatDate(ms: number | null): string {
  return ms === null ? '' : dateFormat.format(ms);
}

/** 0o755 → `rwxr-xr-x`. */
export function formatMode(mode: number | null): string {
  if (mode === null) return '';
  const bits = 'rwxrwxrwx';
  return [...bits].map((ch, i) => (mode & (1 << (8 - i)) ? ch : '-')).join('');
}

export function formatEta(remainingBytes: number, bytesPerSecond: number): string {
  if (bytesPerSecond <= 0 || remainingBytes <= 0) return '';
  const s = Math.round(remainingBytes / bytesPerSecond);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}
