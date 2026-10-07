import { describe, expect, it } from 'vitest';
import type { RemoteEntry } from '@vela-ftp/shared';
import { defaultZipName, uniqueName } from './archives';

const entry = (name: string, type: RemoteEntry['type'] = 'file'): RemoteEntry => ({
  name,
  path: `/${name}`,
  type,
  size: 0,
  modifiedAt: null,
  mode: null,
  owner: null,
  group: null,
  target: null,
});

describe('defaultZipName', () => {
  it('un fichero pierde su extensión; una carpeta no', () => {
    expect(defaultZipName([entry('foto.jpg')], 'fotos')).toBe('foto.zip');
    expect(defaultZipName([entry('web.v2', 'dir')], 'www')).toBe('web.v2.zip');
    expect(defaultZipName([entry('.env')], 'app')).toBe('.env.zip');
  });

  it('varios toman el nombre de la carpeta', () => {
    expect(defaultZipName([entry('a'), entry('b')], 'proyecto')).toBe('proyecto.zip');
    expect(defaultZipName([entry('a'), entry('b')], '')).toBe('Archivo.zip');
  });
});

describe('uniqueName', () => {
  it('numera si ya existe', () => {
    expect(uniqueName('web.zip', new Set())).toBe('web.zip');
    expect(uniqueName('web.zip', new Set(['web.zip', 'web (2).zip']))).toBe('web (3).zip');
  });
});
