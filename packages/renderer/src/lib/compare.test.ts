import { describe, expect, it } from 'vitest';
import type { RemoteEntry } from '@vela-ftp/shared';
import { DATE_TOLERANCE_MS, compareListings, mirrorPath } from './compare';
import { localPaths, remotePaths } from './paths';

const entry = (name: string, size: number, modifiedAt: number | null, type: RemoteEntry['type'] = 'file'): RemoteEntry => ({
  name,
  path: `/${name}`,
  type,
  size,
  modifiedAt,
  mode: null,
  owner: null,
  group: null,
  target: null,
});

describe('compareListings', () => {
  it('clasifica cada entrada frente a la del otro lado', () => {
    const t = 1_700_000_000_000;
    const { local, remote } = compareListings(
      [entry('solo-local.txt', 1, t), entry('igual.txt', 5, t), entry('nuevo.txt', 5, t + DATE_TOLERANCE_MS * 2), entry('tam.txt', 5, null), entry('carpeta', 0, t, 'dir'), entry('choque', 0, t, 'dir')],
      [entry('solo-remoto.txt', 1, t), entry('igual.txt', 5, t + 30_000), entry('nuevo.txt', 5, t), entry('tam.txt', 6, t), entry('carpeta', 0, null, 'dir'), entry('choque', 3, t)],
    );
    expect(Object.fromEntries(local)).toEqual({
      'solo-local.txt': 'only',
      'igual.txt': 'same',
      'nuevo.txt': 'newer',
      'tam.txt': 'different',
      carpeta: 'same',
      choque: 'different',
    });
    expect(Object.fromEntries(remote)).toEqual({
      'solo-remoto.txt': 'only',
      'igual.txt': 'same',
      'nuevo.txt': 'older',
      'tam.txt': 'different',
      carpeta: 'same',
      choque: 'different',
    });
  });

  it('distingue mayúsculas como el servidor', () => {
    const { local, remote } = compareListings([entry('Index.html', 1, null)], [entry('index.html', 1, null)]);
    expect(local.get('Index.html')).toBe('only');
    expect(remote.get('index.html')).toBe('only');
  });
});

describe('mirrorPath', () => {
  const win = localPaths('\\');

  it('traslada la parte relativa al otro lado', () => {
    expect(mirrorPath('C:\\web\\css\\img', 'C:\\web', '/var/www', win, remotePaths)).toBe('/var/www/css/img');
    expect(mirrorPath('/var/www/js', '/var/www', 'C:\\web', remotePaths, win)).toBe('C:\\web\\js');
    expect(mirrorPath('/var/www', '/var/www', 'C:\\web', remotePaths, win)).toBe('C:\\web');
  });

  it('devuelve null fuera de la base', () => {
    expect(mirrorPath('/var', '/var/www', 'C:\\web', remotePaths, win)).toBeNull();
    expect(mirrorPath('D:\\otra', 'C:\\web', '/var/www', win, remotePaths)).toBeNull();
  });
});
