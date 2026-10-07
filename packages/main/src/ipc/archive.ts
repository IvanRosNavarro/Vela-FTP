import { webContents, type WebContents } from 'electron';
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  archiveCancelInputSchema,
  archiveCompressInputSchema,
  archiveExtractInputSchema,
} from '@vela-ftp/shared';
import { logger } from 'vela-kit/logger';
import { createTempDir, removeTempDir } from '../files/tempFiles';
import type { SessionManager } from '../sessions/SessionManager';
import { TransferRequestError, type TransferHost } from '../transfer/TransferHost';
import { handle } from './handle';

/**
 * Extraer y comprimir. El trabajo lo hace el motor; main pone la carpeta
 * temporal y la borra al terminar, y manda el avance solo a la ventana que
 * lo pidió.
 */
export function registerArchiveHandlers(sessions: SessionManager, transfer: TransferHost): void {
  /** Ventana de cada operación en marcha (id de su webContents). */
  const owners = new Map<string, number>();

  transfer.on('archive.progress', (progress) => {
    const id = owners.get(progress.opId);
    const owner = id === undefined ? null : webContents.fromId(id);
    if (owner && !owner.isDestroyed()) owner.send(IPC_EVENTS.ARCHIVE_PROGRESS, progress);
  });

  /** Las sesiones de los lados remotos tienen que estar abiertas. */
  const requireSessions = (...sides: Array<{ kind: 'local' } | { kind: 'remote'; sessionId: string }>) => {
    for (const side of sides) {
      if (side.kind === 'remote' && !sessions.get(side.sessionId)) {
        throw new TransferRequestError({ code: 'NOT_CONNECTED', message: 'La sesión no está abierta' });
      }
    }
  };

  const run = async <T>(opId: string, sender: WebContents, label: string, fn: (workDir: string) => Promise<T>): Promise<T> => {
    const workDir = await createTempDir('archive');
    owners.set(opId, sender.id);
    const started = Date.now();
    try {
      const result = await fn(workDir);
      logger.info(`[archive] ${label} en ${Date.now() - started} ms`);
      return result;
    } finally {
      owners.delete(opId);
      await removeTempDir(workDir);
    }
  };

  handle(IPC_CHANNELS.ARCHIVE_EXTRACT, archiveExtractInputSchema, (input, event) => {
    requireSessions(input.source, input.targetDir);
    return run(input.opId, event.sender, `extraído (${input.source.kind} → ${input.targetDir.kind})`, (workDir) =>
      transfer.request('archive.extract', { ...input, workDir }),
    );
  });

  handle(IPC_CHANNELS.ARCHIVE_COMPRESS, archiveCompressInputSchema, (input, event) => {
    requireSessions(input.sources, input.target);
    return run(input.opId, event.sender, `comprimido (${input.sources.kind} → ${input.target.kind})`, (workDir) =>
      transfer.request('archive.compress', { ...input, workDir }),
    );
  });

  handle(IPC_CHANNELS.ARCHIVE_CANCEL, archiveCancelInputSchema, ({ opId }) => transfer.request('archive.cancel', { opId }));
}
