import { describe, expect, it } from 'vitest';
import type { Site } from '@vela-ftp/shared';
import { mostUsedFirst } from './quickConnect';

const site = (name: string, uses: number, lastUsedAt: number | null): Site => ({
  id: name,
  name,
  protocol: 'sftp',
  host: `${name}.example.com`,
  port: 22,
  username: 'u',
  auth: 'password',
  keyPath: null,
  initialRemotePath: null,
  initialLocalPath: null,
  maxConnections: 2,
  notes: '',
  projectId: null,
  position: name,
  hasPassword: false,
  hasPassphrase: false,
  createdAt: 0,
  updatedAt: 0,
  uses,
  lastUsedAt,
});

const names = (sites: Site[]) => sites.map((s) => s.name);

describe('mostUsedFirst', () => {
  it('ofrece antes los más usados', () => {
    const sites = [site('a', 1, 100), site('b', 9, 50), site('c', 4, 10)];
    expect(names(mostUsedFirst(sites))).toEqual(['b', 'c', 'a']);
  });

  it('a igualdad de usos, el usado hace menos', () => {
    const sites = [site('viejo', 3, 100), site('reciente', 3, 900)];
    expect(names(mostUsedFirst(sites))).toEqual(['reciente', 'viejo']);
  });

  it('recién instalado conserva el orden de la sidebar', () => {
    const sites = [site('primero', 0, null), site('segundo', 0, null), site('tercero', 0, null)];
    expect(names(mostUsedFirst(sites))).toEqual(['primero', 'segundo', 'tercero']);
  });

  it('no toca la lista original', () => {
    const sites = [site('a', 0, null), site('b', 5, 1)];
    mostUsedFirst(sites);
    expect(names(sites)).toEqual(['a', 'b']);
  });
});
