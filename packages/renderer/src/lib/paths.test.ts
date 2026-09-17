import { describe, expect, it } from 'vitest';
import { formatMode, formatSize } from './format';
import { isValidName, localPaths, remotePaths } from './paths';

describe('rutas', () => {
  it('remotas POSIX', () => {
    expect(remotePaths.join('/', 'a')).toBe('/a');
    expect(remotePaths.join('/var/www', 'index.html')).toBe('/var/www/index.html');
    expect(remotePaths.parent('/var/www')).toBe('/var');
    expect(remotePaths.parent('/var')).toBe('/');
    expect(remotePaths.parent('/')).toBeNull();
    expect(remotePaths.basename('/var/www/')).toBe('www');
  });

  it('locales de Windows', () => {
    const win = localPaths('\\');
    expect(win.join('C:\\', 'Users')).toBe('C:\\Users');
    expect(win.join('C:\\Users', 'ivan')).toBe('C:\\Users\\ivan');
    expect(win.parent('C:\\Users')).toBe('C:\\');
    expect(win.parent('C:\\Users\\ivan')).toBe('C:\\Users');
    expect(win.parent('C:\\')).toBeNull();
    expect(win.basename('C:\\Users\\ivan')).toBe('ivan');
    expect(win.isRoot('D:\\')).toBe(true);
  });

  it('locales POSIX', () => {
    const posix = localPaths('/');
    expect(posix.parent('/home')).toBe('/');
    expect(posix.parent('/')).toBeNull();
  });

  it('valida nombres', () => {
    expect(isValidName('informe final.pdf')).toBe(true);
    expect(isValidName('..')).toBe(false);
    expect(isValidName('a/b')).toBe(false);
    expect(isValidName('  ')).toBe(false);
    expect(isValidName('10:30.log')).toBe(true);
    expect(isValidName('10:30.log', true)).toBe(false);
  });
});

describe('formato', () => {
  it('tamaños y permisos', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(50 * 1024 * 1024)).toBe('50 MB');
    expect(formatMode(0o755)).toBe('rwxr-xr-x');
    expect(formatMode(0o640)).toBe('rw-r-----');
  });
});
