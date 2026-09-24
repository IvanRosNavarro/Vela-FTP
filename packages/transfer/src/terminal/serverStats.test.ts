import { describe, expect, it } from 'vitest';
import { STATS_COMMAND, StatsParser, diskCommand, parseDf } from './serverStats';

/** Un bloque del bucle con los contadores dados. */
function frame(cpu: number[], rx: number, tx: number, extra: string[] = []): string {
  return [
    '@@S',
    `cpu  ${cpu.join(' ')} 0 0`,
    'MemTotal: 8000000',
    'MemFree: 1000000',
    'MemAvailable: 3000000',
    'SwapTotal: 2000000',
    'SwapFree: 1500000',
    ...extra,
    'L 0.42 0.38 0.30 2/345 6789',
    'U 93784.12 180000.00',
    'I     lo: 999999 10 0 0 0 0 0 0 999999 10 0 0 0 0 0 0',
    `I   eth0: ${rx} 100 0 0 0 0 0 0 ${tx} 80 0 0 0 0 0 0`,
    'I docker0:5000 1 0 0 0 0 0 0 7000 1 0 0 0 0 0 0',
    '@@E',
    '',
  ].join('\n');
}

describe('StatsParser', () => {
  it('saca CPU y red de la diferencia entre muestras y la RAM de MemAvailable', () => {
    let now = 0;
    const parser = new StatsParser(() => now);
    expect(parser.push('@@N 4\n')).toEqual([]);

    const [first] = parser.push(frame([100, 0, 100, 800, 0, 0, 0, 0], 10_000, 20_000));
    expect(first).toMatchObject({ cpu: null, cores: 4, rxRate: null, txRate: null });
    expect(first!.memTotal).toBe(8_000_000 * 1024);
    expect(first!.memUsed).toBe(5_000_000 * 1024);
    expect(first!.swapUsed).toBe(500_000 * 1024);
    expect(first!.load).toEqual([0.42, 0.38, 0.3]);
    expect(first!.uptime).toBeCloseTo(93784.12);

    now = 2000;
    // 100 ticks más, 25 de ellos ocupados; 2 s después.
    const [second] = parser.push(frame([115, 0, 110, 875, 0, 0, 0, 0], 10_000 + 4096, 20_000 + 1024));
    expect(second!.cpu).toBeCloseTo(25);
    // lo no cuenta; docker0 sí, pero no cambia.
    expect(second!.rxRate).toBe(2048);
    expect(second!.txRate).toBe(512);
  });

  it('admite bloques partidos en trozos cualesquiera', () => {
    const parser = new StatsParser();
    const text = '@@N 2\n' + frame([1, 0, 1, 10, 0, 0, 0, 0], 1, 1);
    const out = [...text].flatMap((ch) => parser.push(ch));
    expect(out).toHaveLength(1);
    expect(out[0]!.cores).toBe(2);
  });

  it('sin MemAvailable (kernel antiguo) aproxima con libre, buffers y caché', () => {
    const parser = new StatsParser();
    const text = frame([1, 0, 1, 10, 0, 0, 0, 0], 1, 1, ['Buffers: 500000', 'Cached: 1500000']).replace('MemAvailable: 3000000\n', '');
    const [stats] = parser.push(text);
    expect(stats!.memUsed).toBe((8_000_000 - 3_000_000) * 1024);
  });

  it('marca el servidor sin /proc', () => {
    const parser = new StatsParser();
    parser.push('@@X\n');
    expect(parser.unavailable).toBe(true);
  });
});

describe('órdenes y df', () => {
  it('el bucle cabe en una línea y sin comillas simples dentro', () => {
    expect(STATS_COMMAND).not.toContain('\n');
    expect(STATS_COMMAND.slice("sh -c '".length, -1)).not.toContain("'");
  });

  it('pasa la carpeta como argumento bien entrecomillado', () => {
    expect(diskCommand("/srv/l'olivera")).toBe(`sh -c 'LC_ALL=C df -Pk -- "$0"' '/srv/l'\\''olivera'`);
  });

  it('lee la última línea de df -Pk, con espacios en el punto de montaje', () => {
    const out = 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 1000 250 750 25% /mnt/mis datos\n';
    expect(parseDf(out, '/mnt/mis datos/web')).toEqual({ path: '/mnt/mis datos/web', mount: '/mnt/mis datos', total: 1000 * 1024, used: 250 * 1024 });
    expect(parseDf('df: no existe', '/x')).toBeNull();
  });
});
