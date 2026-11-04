import { call } from './ipc';

/** Ids por llamada: el IPC y el motor admiten como mucho 10 000. */
export const QUEUE_BATCH = 5000;

export function inBatches<T>(items: T[], size = QUEUE_BATCH): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

/** Cancela, reintenta o quita trabajos en tandas, para colas de decenas de miles. */
export async function queueAction(action: 'cancel' | 'retry' | 'remove', ids: string[]): Promise<void> {
  for (const batch of inBatches(ids)) await call(window.api.queue[action](batch));
}

/** Reanuda trabajos recuperados en tandas. Devuelve cuántos se han reencolado. */
export async function resumeInBatches(sessionId: string, ids: string[]): Promise<number> {
  let created = 0;
  for (const batch of inBatches(ids)) created += (await call(window.api.queue.resume(sessionId, batch))).length;
  return created;
}
