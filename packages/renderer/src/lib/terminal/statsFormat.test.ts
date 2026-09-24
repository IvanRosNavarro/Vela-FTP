import { describe, expect, it } from 'vitest';
import { formatLoad, formatPercent, formatRate, formatUptime, meterLevel, percentOf } from './statsFormat';

describe('formatos del estado del servidor', () => {
  it('niveles del medidor', () => {
    expect(meterLevel(40)).toBe('normal');
    expect(meterLevel(85)).toBe('high');
    expect(meterLevel(99)).toBe('critical');
  });
  it('porcentajes acotados y sin división por cero', () => {
    expect(percentOf(3, 4)).toBe(75);
    expect(percentOf(5, 4)).toBe(100);
    expect(percentOf(1, 0)).toBe(0);
    expect(formatPercent(33.6)).toBe('34 %');
  });
  it('red, carga y tiempo encendido', () => {
    expect(formatRate(null)).toBe('…');
    expect(formatRate(0)).toBe('0 B/s');
    expect(formatRate(2048)).toBe('2.0 KB/s');
    expect(formatLoad([0.4, 1, 12.345])).toBe('0.40 1.00 12.35');
    expect(formatUptime(125)).toBe('2 min');
    expect(formatUptime(5 * 3600 + 12 * 60)).toBe('5 h 12 min');
    expect(formatUptime(3 * 86400 + 4 * 3600 + 59)).toBe('3 d 4 h');
  });
});
