import { describe, expect, it } from 'vitest';
import type { RemoteEntry } from '@vela-ftp/shared';
import { availableColumns, cellText, fileType, gridTemplate, minGridWidth, visibleColumns } from './columns';

const entry = (partial: Partial<RemoteEntry>): RemoteEntry => ({
  name: 'index.php',
  path: '/index.php',
  type: 'file',
  size: 2048,
  modifiedAt: null,
  mode: 0o640,
  owner: 'www-data',
  group: 'staff',
  target: null,
  ...partial,
});

describe('columnas', () => {
  it('en remoto están todas; en local, solo las que tienen datos', () => {
    expect(availableColumns('remote', 'win32')).toContain('owner');
    expect(availableColumns('local', 'win32')).toEqual(['size', 'type', 'modifiedAt']);
    expect(availableColumns('local', 'linux')).toContain('mode');
    expect(availableColumns('local', 'linux')).not.toContain('owner');
  });

  it('muestra las elegidas en orden fijo y descarta las que no caben en ese lado', () => {
    expect(visibleColumns(['owner', 'size', 'mode'], 'remote', 'win32')).toEqual(['size', 'mode', 'owner']);
    expect(visibleColumns(['owner', 'size', 'mode'], 'local', 'win32')).toEqual(['size']);
  });

  it('el nombre ocupa lo que sobra, pero nunca menos de su mínimo', () => {
    expect(gridTemplate([])).toBe('minmax(160px,1fr)');
    expect(gridTemplate(['size', 'owner'])).toBe('minmax(160px,1fr) 80px 96px');
    // 160 del nombre + 16 de márgenes + (80 + 8) + (96 + 8)
    expect(minGridWidth(['size', 'owner'])).toBe(368);
  });

  it('describe el tipo como el explorador', () => {
    expect(fileType({ name: 'app', type: 'dir' })).toBe('Carpeta');
    expect(fileType({ name: 'actual', type: 'dir', target: 'web' })).toBe('Enlace a carpeta');
    expect(fileType({ name: 'actual', type: 'symlink' })).toBe('Enlace');
    expect(fileType({ name: 'logo.png', type: 'file' })).toBe('Fichero PNG');
    expect(fileType({ name: '.htaccess', type: 'file' })).toBe('Fichero');
    expect(fileType({ name: 'Makefile', type: 'file' })).toBe('Fichero');
  });

  it('rellena cada celda', () => {
    const file = entry({});
    expect(cellText(file, 'owner')).toBe('www-data');
    expect(cellText(file, 'group')).toBe('staff');
    expect(cellText(file, 'mode')).toBe('rw-r-----');
    expect(cellText(entry({ type: 'dir' }), 'size')).toBe('');
    expect(cellText(entry({ owner: null }), 'owner')).toBe('');
    expect(cellText(entry({ type: 'symlink', target: '/var/www/v2' }), 'target')).toBe('/var/www/v2');
  });
});

describe('ordenar por las columnas nuevas', async () => {
  const { sortEntries } = await import('../stores/panesStore');
  const files = [
    entry({ name: 'b.txt', owner: 'root' }),
    entry({ name: 'a.php', owner: 'www-data' }),
    entry({ name: 'c.css', owner: 'deploy' }),
  ];
  const names = (list: RemoteEntry[]) => list.map((e) => e.name);

  it('por propietario', () => {
    expect(names(sortEntries(files, { key: 'owner', dir: 'asc' }, true))).toEqual(['c.css', 'b.txt', 'a.php']);
  });

  it('por tipo', () => {
    expect(names(sortEntries(files, { key: 'type', dir: 'asc' }, true))).toEqual(['c.css', 'a.php', 'b.txt']);
  });
});
