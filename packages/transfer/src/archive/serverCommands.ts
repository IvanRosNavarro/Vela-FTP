import { archiveStem, type ArchiveConflict, type ArchiveFormat } from '@vela-ftp/shared';
import { basenameRemote, joinRemote, type ExecResult } from '../fs/RemoteFs';

// Órdenes para extraer y comprimir en el servidor por SSH, sin bajar nada. El
// script va entre comillas simples y sin ninguna dentro; las rutas van como
// argumentos (`$0`, `$1`…), así que no hay que escaparlas en el script.

/** Entrecomilla para el shell del usuario: vale en sh, bash, zsh, fish y csh. */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sh(script: string, args: string[]): string {
  return `sh -c '${script}' ${args.map(shQuote).join(' ')}`;
}

/** Programa del servidor que hace falta para cada formato. */
export const SERVER_TOOL: Record<ArchiveFormat, string> = { zip: 'unzip', tar: 'tar', 'tar.gz': 'tar', gz: 'gzip' };

export function hasToolCommand(tool: string): string {
  return sh('command -v "$0" >/dev/null 2>&1', [tool]);
}

export function serverExtractCommand(format: ArchiveFormat, archive: string, targetDir: string, conflict: ArchiveConflict): string {
  const skip = conflict === 'skip';
  switch (format) {
    case 'zip':
      return sh(`mkdir -p "$1" && unzip -q ${skip ? '-n' : '-o'} "$0" -d "$1"`, [archive, targetDir]);
    case 'tar':
    case 'tar.gz':
      // -o: los ficheros son del usuario que extrae, aunque sea root.
      return sh(`mkdir -p "$1" && tar -x${format === 'tar.gz' ? 'z' : ''}${skip ? 'k' : ''}o -f "$0" -C "$1"`, [archive, targetDir]);
    case 'gz': {
      const target = joinRemote(targetDir, archiveStem(basenameRemote(archive)));
      const write = 'gzip -dc "$0" > "$2"';
      return sh(`mkdir -p "$1" && ${skip ? `{ [ -e "$2" ] || ${write}; }` : write}`, [archive, targetDir, target]);
    }
  }
}

/** Comprime `names` (de la carpeta `dir`) en `zipPath`. */
export function serverCompressCommand(dir: string, zipPath: string, names: string[]): string {
  // `./nombre`: un nombre que empiece por guion no se toma por opción; zip quita el `./`.
  return sh('cd "$0" && t="$1" && shift && zip -q -r "$t" "$@"', [dir, zipPath, ...names.map((n) => `./${n}`)]);
}

/**
 * Mensaje de error de una orden, o null si fue bien. `unzip` sale con 1 por
 * avisos que no impiden extraer; `tar -k` sale con error por cada fichero que
 * ya existía y no tocó, que es justo lo pedido.
 */
export function serverFailure(tool: string, conflict: ArchiveConflict, result: ExecResult): string | null {
  if (result.code === 0) return null;
  if (tool === 'unzip' && result.code === 1) return null;
  const lines = result.stderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (tool === 'tar' && conflict === 'skip') {
    const real = lines.filter((l) => !/exists/i.test(l) && !/exiting with failure status/i.test(l));
    if (lines.length > 0 && real.length === 0) return null;
  }
  return lines.at(-1) ?? (result.code === null ? 'La orden se interrumpió' : `${tool} terminó con el código ${result.code}`);
}
