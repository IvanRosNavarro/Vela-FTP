import { z } from 'zod';
import type { ConflictInfo, JobSnapshot, ProtocolLogLine, RemoteEntry, TransferError } from './types';

// Mensajes entre main y el utilityProcess de transferencias. main valida lo que
// recibe del motor por forma; el motor valida cada petición con estos schemas.

const protocolSchema = z.enum(['ftp', 'ftps', 'ftps-implicit', 'sftp']);
const remotePath = z.string().min(1).max(4096).startsWith('/');
const localPath = z.string().min(1).max(4096);
const sessionId = z.string().min(1).max(100);

export const connectionConfigSchema = z.object({
  protocol: protocolSchema,
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(255),
  auth: z.enum(['password', 'key', 'agent', 'anonymous']),
  password: z.string().max(4096).optional(),
  privateKey: z.string().max(64_000).optional(),
  passphrase: z.string().max(4096).optional(),
  trustedFingerprints: z.array(z.string().max(200)).max(50),
  timeoutMs: z.number().int().min(1000).max(300_000).optional(),
});

export const conflictPolicySchema = z.enum(['ask', 'overwrite', 'overwrite-if-newer', 'resume', 'rename', 'skip']);

export const transferJobSchema = z.object({
  id: z.string().min(1).max(100),
  sessionId,
  direction: z.enum(['upload', 'download']),
  localPath,
  remotePath,
  isDirectory: z.boolean(),
  conflictPolicy: conflictPolicySchema,
  parentId: z.string().max(100).nullable(),
});

export const TRANSFER_REQUEST_SCHEMAS = {
  'session.open': z.object({
    sessionId,
    config: connectionConfigSchema,
    maxTransferConnections: z.number().int().min(1).max(10),
  }),
  'session.close': z.object({ sessionId }),
  'fs.list': z.object({ sessionId, path: remotePath }),
  'fs.stat': z.object({ sessionId, path: remotePath }),
  'fs.mkdir': z.object({ sessionId, path: remotePath }),
  'fs.rename': z.object({ sessionId, from: remotePath, to: remotePath }),
  'fs.delete': z.object({ sessionId, path: remotePath, isDirectory: z.boolean() }),
  'fs.chmod': z.object({ sessionId, path: remotePath, mode: z.number().int().min(0).max(0o7777) }),
  'fs.realpath': z.object({ sessionId, path: z.string().min(1).max(4096) }),
  'queue.enqueue': z.object({ jobs: z.array(transferJobSchema).min(1).max(10_000) }),
  'queue.cancel': z.object({ jobIds: z.array(z.string()).max(10_000) }),
  'queue.retry': z.object({ jobIds: z.array(z.string()).max(10_000) }),
  'queue.remove': z.object({ jobIds: z.array(z.string()).max(10_000) }),
  'queue.resolveConflict': z.object({
    jobId: z.string(),
    decision: z.enum(['overwrite', 'overwrite-if-newer', 'resume', 'rename', 'skip']),
    applyToAll: z.boolean(),
  }),
} as const;

export type TransferMethod = keyof typeof TRANSFER_REQUEST_SCHEMAS;
export type TransferParams<M extends TransferMethod> = z.input<(typeof TRANSFER_REQUEST_SCHEMAS)[M]>;

export interface TransferResults {
  'session.open': { homePath: string };
  'session.close': null;
  'fs.list': RemoteEntry[];
  'fs.stat': RemoteEntry;
  'fs.mkdir': null;
  'fs.rename': null;
  'fs.delete': null;
  'fs.chmod': null;
  'fs.realpath': string;
  'queue.enqueue': null;
  'queue.cancel': null;
  'queue.retry': null;
  'queue.remove': null;
  'queue.resolveConflict': null;
}

export interface TransferEvents {
  /** Cambios de la cola desde el último envío (como mucho cada 100 ms). */
  'queue.updated': { jobs: JobSnapshot[]; removedIds: string[] };
  'queue.conflict': ConflictInfo;
  log: ProtocolLogLine;
  /** La conexión de navegación se cerró sin pedirlo (caída, timeout del servidor). */
  'session.lost': { sessionId: string; error: TransferError };
}

export type TransferEventName = keyof TransferEvents;

export type MainToTransferMessage = {
  kind: 'request';
  id: number;
  method: TransferMethod;
  params: unknown;
};

export type TransferToMainMessage =
  | { kind: 'response'; id: number; ok: true; data: unknown }
  | { kind: 'response'; id: number; ok: false; error: TransferError }
  | { kind: 'event'; name: TransferEventName; payload: unknown };
