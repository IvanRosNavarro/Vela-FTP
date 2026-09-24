import type { Client, ClientChannel } from 'ssh2';
import type { DiskUsage, ServerStats } from '@vela-ftp/shared';

/**
 * Bucle en `sh` que vuelca `/proc` cada segundo. Solo usa órdenes internas del
 * shell (`read`, `echo`, `case`): lo único que arranca un proceso es el `sleep`.
 * Va en una línea y sin comillas simples para que lo acepte cualquier shell de
 * inicio del usuario (bash, zsh, fish, csh) dentro de `sh -c '…'`.
 */
const STATS_SCRIPT = [
  'LC_ALL=C',
  'export LC_ALL',
  '[ -r /proc/stat ] || { echo @@X; exit 0; }',
  'n=0',
  'while read -r a b; do case $a in cpu[0-9]*) n=$((n+1));; esac; done < /proc/stat',
  'echo "@@N $n"',
  'while :; do echo @@S',
  'read -r l < /proc/stat',
  'echo "$l"',
  'while read -r k v u; do case $k in MemTotal:|MemFree:|MemAvailable:|Buffers:|Cached:|SwapTotal:|SwapFree:) echo "$k $v";; esac; done < /proc/meminfo',
  'read -r l < /proc/loadavg',
  'echo "L $l"',
  'read -r l < /proc/uptime',
  'echo "U $l"',
  'while read -r l; do case $l in *:*) echo "I $l";; esac; done < /proc/net/dev',
  'echo @@E',
  'sleep 1',
  'done',
].join('; ');

export const STATS_COMMAND = `sh -c '${STATS_SCRIPT}'`;

/** Entrecomilla para el shell del usuario: vale en sh, bash, zsh, fish y csh. */
function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** `df` de una carpeta; la ruta va como `$0` para no tener que escaparla dentro del script. */
export function diskCommand(path: string): string {
  return `sh -c 'LC_ALL=C df -Pk -- "$0"' ${quote(path)}`;
}

/** Última línea de `df -Pk`: sistema, bloques de 1K, usados, libres, %, punto de montaje. */
export function parseDf(output: string, path: string): DiskUsage | null {
  const line = output.trim().split('\n').at(-1) ?? '';
  const parts = line.trim().split(/\s+/);
  if (parts.length < 6) return null;
  const total = Number(parts[1]);
  const used = Number(parts[2]);
  if (!Number.isFinite(total) || !Number.isFinite(used) || total <= 0) return null;
  return { path, mount: parts.slice(5).join(' '), total: total * 1024, used: used * 1024 };
}

interface Sample {
  at: number;
  cpuBusy: number;
  cpuTotal: number;
  rx: number;
  tx: number;
}

/**
 * Lee la salida del bucle por trozos y devuelve una muestra por cada bloque
 * `@@S … @@E`. La CPU y la red salen de la diferencia con la muestra anterior.
 */
export class StatsParser {
  private buffer = '';
  private block: string[] | null = null;
  private cores: number | null = null;
  private previous: Sample | null = null;
  /** El servidor no tiene `/proc` (no es Linux). */
  unavailable = false;

  constructor(private readonly now: () => number = Date.now) {}

  push(text: string): ServerStats[] {
    this.buffer += text;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    const out: ServerStats[] = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (line === '@@X') this.unavailable = true;
      else if (line.startsWith('@@N ')) this.cores = Number(line.slice(4)) || null;
      else if (line === '@@S') this.block = [];
      else if (line === '@@E') {
        const stats = this.block ? this.parseBlock(this.block) : null;
        this.block = null;
        if (stats) out.push(stats);
      } else this.block?.push(line);
    }
    return out;
  }

  private parseBlock(lines: string[]): ServerStats | null {
    const cpuLine = lines.find((l) => l.startsWith('cpu '));
    if (!cpuLine) return null;
    // user nice system idle iowait irq softirq steal: lo ocioso es idle + iowait.
    const ticks = cpuLine.split(/\s+/).slice(1, 9).map(Number);
    const cpuTotal = ticks.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    const cpuBusy = cpuTotal - (ticks[3] ?? 0) - (ticks[4] ?? 0);

    const mem = new Map<string, number>();
    let load: [number, number, number] = [0, 0, 0];
    let uptime = 0;
    let rx = 0;
    let tx = 0;
    for (const line of lines) {
      const [key, value] = line.split(/\s+/);
      if (key?.endsWith(':') && value !== undefined) mem.set(key.slice(0, -1), Number(value) * 1024);
      else if (key === 'L') {
        const [a, b, c] = line.split(/\s+/).slice(1, 4).map(Number);
        load = [a ?? 0, b ?? 0, c ?? 0];
      } else if (key === 'U') uptime = Number(line.split(/\s+/)[1]) || 0;
      else if (key === 'I') {
        // `eth0: 123 …` o `eth0:123 …` con cifras grandes.
        const colon = line.indexOf(':');
        const name = line.slice(2, colon).trim();
        if (name === 'lo') continue;
        const fields = line.slice(colon + 1).trim().split(/\s+/).map(Number);
        rx += fields[0] ?? 0;
        tx += fields[8] ?? 0;
      }
    }

    const memTotal = mem.get('MemTotal') ?? 0;
    // MemAvailable no existe antes del kernel 3.14: se aproxima con libre + buffers + caché.
    const available = mem.get('MemAvailable') ?? (mem.get('MemFree') ?? 0) + (mem.get('Buffers') ?? 0) + (mem.get('Cached') ?? 0);
    const swapTotal = mem.get('SwapTotal') ?? 0;

    const sample: Sample = { at: this.now(), cpuBusy, cpuTotal, rx, tx };
    const prev = this.previous;
    this.previous = sample;
    const seconds = prev ? (sample.at - prev.at) / 1000 : 0;
    const dTotal = prev ? cpuTotal - prev.cpuTotal : 0;
    const rate = (now: number, before: number) => (seconds > 0 && now >= before ? (now - before) / seconds : null);

    return {
      cpu: prev && dTotal > 0 ? Math.min(100, Math.max(0, ((cpuBusy - prev.cpuBusy) / dTotal) * 100)) : null,
      cores: this.cores,
      memTotal,
      memUsed: Math.max(0, memTotal - available),
      swapTotal,
      swapUsed: Math.max(0, swapTotal - (mem.get('SwapFree') ?? swapTotal)),
      load,
      uptime,
      rxRate: prev ? rate(rx, prev.rx) : null,
      txRate: prev ? rate(tx, prev.tx) : null,
    };
  }
}

/** Salidas del monitor hacia la terminal. */
export interface MonitorSink {
  stats(stats: ServerStats): void;
  disk(disk: DiskUsage | null): void;
  unavailable(reason: string): void;
}

/** Sin `/proc`: no es Linux, o la shell está enjaulada (Plesk «chrooted»). */
const NO_PROC = 'El servidor no da su estado (solo Linux, y sin shell enjaulada)';

const DISK_INTERVAL_MS = 30_000;
const DISK_DEBOUNCE_MS = 300;
const DISK_TIMEOUT_MS = 10_000;

/**
 * Estado del servidor sobre la conexión de una terminal: un canal `exec` con el
 * bucle de `/proc` y, cada 30 s o al cambiar de carpeta, un `df`.
 */
export class ServerMonitor {
  private channel: ClientChannel | null = null;
  private running = false;
  private gotStats = false;
  private diskPath: string | null = null;
  private diskTimer: ReturnType<typeof setInterval> | null = null;
  private diskDebounce: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly conn: Client,
    private readonly sink: MonitorSink,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.gotStats = false;
    const parser = new StatsParser();
    this.conn.exec(STATS_COMMAND, (err, channel) => {
      if (err) {
        this.running = false;
        this.sink.unavailable('El servidor no deja ejecutar órdenes');
        return;
      }
      if (!this.running) {
        channel.close();
        return;
      }
      this.channel = channel;
      channel.on('data', (chunk: Buffer) => {
        for (const stats of parser.push(chunk.toString('utf8'))) {
          this.gotStats = true;
          this.sink.stats(stats);
        }
        if (parser.unavailable) this.stopWith(NO_PROC);
      });
      channel.stderr.on('data', () => undefined);
      channel.on('close', () => {
        if (this.channel !== channel) return;
        this.channel = null;
        if (this.running) this.stopWith(this.gotStats ? 'El servidor dejó de enviar su estado' : NO_PROC);
      });
    });
    this.diskTimer = setInterval(() => this.refreshDisk(), DISK_INTERVAL_MS);
    this.refreshDisk();
  }

  setDiskPath(path: string | null): void {
    if (path === this.diskPath) return;
    this.diskPath = path;
    if (!this.running) return;
    if (this.diskDebounce) clearTimeout(this.diskDebounce);
    this.diskDebounce = setTimeout(() => this.refreshDisk(), DISK_DEBOUNCE_MS);
  }

  private refreshDisk(): void {
    const path = this.diskPath;
    if (!this.running || !path) return;
    this.conn.exec(diskCommand(path), (err, channel) => {
      if (err) return;
      let output = '';
      const timer = setTimeout(() => channel.close(), DISK_TIMEOUT_MS);
      channel.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
      channel.stderr.on('data', () => undefined);
      channel.on('close', () => {
        clearTimeout(timer);
        // Una respuesta de otra carpeta que llega tarde no pisa la actual.
        if (this.running && path === this.diskPath) this.sink.disk(parseDf(output, path));
      });
    });
  }

  private stopWith(reason: string): void {
    this.stop();
    this.sink.unavailable(reason);
  }

  stop(): void {
    this.running = false;
    if (this.diskTimer) clearInterval(this.diskTimer);
    if (this.diskDebounce) clearTimeout(this.diskDebounce);
    this.diskTimer = null;
    this.diskDebounce = null;
    const channel = this.channel;
    this.channel = null;
    // Al cerrar el canal, el `echo` siguiente del bucle muere con SIGPIPE.
    channel?.close();
  }
}
