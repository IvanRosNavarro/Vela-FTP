/** Operaciones de ruta para cada lado: el remoto es siempre POSIX. */
export interface PathOps {
  join(dir: string, name: string): string;
  parent(path: string): string | null;
  basename(path: string): string;
  isRoot(path: string): boolean;
}

export const remotePaths: PathOps = {
  join: (dir, name) => (dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`),
  parent: (path) => {
    if (path === '/') return null;
    const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
    const idx = trimmed.lastIndexOf('/');
    return idx <= 0 ? '/' : trimmed.slice(0, idx);
  },
  basename: (path) => {
    const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
    return trimmed.slice(trimmed.lastIndexOf('/') + 1);
  },
  isRoot: (path) => path === '/',
};

export function localPaths(separator: '/' | '\\'): PathOps {
  const isWin = separator === '\\';
  const isRoot = (p: string) => (isWin ? /^[A-Za-z]:\\?$/.test(p) || /^\\\\[^\\]+\\[^\\]+\\?$/.test(p) : p === '/');
  return {
    join: (dir, name) => (dir.endsWith(separator) ? `${dir}${name}` : `${dir}${separator}${name}`),
    parent: (p) => {
      if (isRoot(p)) return null;
      const trimmed = p.endsWith(separator) ? p.slice(0, -1) : p;
      const idx = trimmed.lastIndexOf(separator);
      if (idx < 0) return null;
      const parent = trimmed.slice(0, idx);
      if (isWin && /^[A-Za-z]:$/.test(parent)) return `${parent}\\`;
      return parent === '' ? separator : parent;
    },
    basename: (p) => {
      const trimmed = p.endsWith(separator) && !isRoot(p) ? p.slice(0, -1) : p;
      return trimmed.slice(trimmed.lastIndexOf(separator) + 1);
    },
    isRoot,
  };
}

/**
 * Nombre válido para crear o renombrar. En Windows (`windows = true`) se
 * rechazan además los caracteres que su sistema de ficheros no admite; en un
 * servidor remoto son válidos.
 */
export function isValidName(name: string, windows = false): boolean {
  if (name.trim().length === 0 || name === '.' || name === '..' || /[\\/\0]/.test(name)) return false;
  return !windows || !/[<>:"|?*]/.test(name);
}
