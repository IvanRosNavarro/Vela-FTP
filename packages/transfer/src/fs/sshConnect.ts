import { createHash } from 'node:crypto';
import { Client, type ConnectConfig } from 'ssh2';
import type { ConnectionConfig } from '@vela-ftp/shared';
import { TransferFailure, toFailure } from '../errors';
import type { LogSink } from './RemoteFs';

const DEFAULT_TIMEOUT = 30_000;

/** Huella de clave de host al estilo OpenSSH (`SHA256:…`), con el tipo de clave. */
export function hostKeyFingerprint(key: Buffer): { fingerprint: string; keyType: string } {
  const digest = createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
  const typeLength = key.length >= 4 ? key.readUInt32BE(0) : 0;
  const keyType = typeLength > 0 && typeLength < key.length ? key.subarray(4, 4 + typeLength).toString('ascii') : 'desconocido';
  return { fingerprint: `SHA256:${digest}`, keyType };
}

/** Errores de la conexión SSH en sí (autenticación, timeout, cierre). */
export function mapSshError(err: unknown): TransferFailure {
  if (err instanceof TransferFailure) return err;
  const e = err as { level?: string; message?: string };
  if (e?.level === 'client-authentication') {
    return new TransferFailure('AUTH_FAILED', 'Autenticación rechazada por el servidor');
  }
  if (e?.level === 'client-timeout') return new TransferFailure('TIMEOUT', e.message ?? 'Tiempo de espera agotado');
  if (e?.message && /No SFTP|Not connected|closed/i.test(e.message)) {
    return new TransferFailure('NOT_CONNECTED', e.message);
  }
  return toFailure(err);
}

/**
 * Abre y autentica una conexión SSH con la verificación de huella de la app.
 * La usan el adaptador SFTP y la terminal: cada uno pide después su canal.
 */
export async function connectSsh(config: ConnectionConfig, log: LogSink): Promise<Client> {
  const { host, port, username, auth } = config;
  const conn = new Client();
  let hostKeyFailure: TransferFailure | null = null;

  const options: ConnectConfig = {
    host,
    port,
    username,
    readyTimeout: config.timeoutMs ?? DEFAULT_TIMEOUT,
    keepaliveInterval: 15_000,
    keepaliveCountMax: 3,
    tryKeyboard: auth === 'password',
    hostVerifier: (key: Buffer) => {
      const { fingerprint, keyType } = hostKeyFingerprint(key);
      const trusted = config.trustedFingerprints.filter((f) => f.startsWith('SHA256:'));
      if (trusted.includes(fingerprint)) return true;
      hostKeyFailure =
        trusted.length === 0
          ? new TransferFailure('HOST_KEY_UNKNOWN', `Clave de host desconocida (${keyType})`, { fingerprint, keyType })
          : new TransferFailure('HOST_KEY_MISMATCH', 'La clave de host ha cambiado desde la última conexión', {
              fingerprint,
              keyType,
              expected: trusted.join(', '),
            });
      log('error', hostKeyFailure.message);
      return false;
    },
  };
  if (auth === 'password') options.password = config.password ?? '';
  if (auth === 'key') {
    options.privateKey = config.privateKey ?? '';
    if (config.passphrase) options.passphrase = config.passphrase;
  }
  if (auth === 'agent') {
    const agent = process.platform === 'win32' ? 'pageant' : process.env['SSH_AUTH_SOCK'];
    if (!agent) throw new TransferFailure('AUTH_FAILED', 'No hay agente SSH disponible (SSH_AUTH_SOCK)');
    options.agent = agent;
  }

  conn.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
    finish(prompts.map(() => config.password ?? ''));
  });
  conn.on('banner', (message) => log('response', message.trimEnd()));

  log('info', `Conectando a ${host}:${port}…`);
  try {
    await new Promise<void>((resolve, reject) => {
      conn.once('ready', resolve);
      conn.once('error', reject);
      try {
        conn.connect(options);
      } catch (err) {
        // ssh2 lanza en síncrono si no puede leer la clave privada.
        reject(new TransferFailure('AUTH_FAILED', `Clave privada no válida o passphrase incorrecta: ${(err as Error).message}`));
      }
    });
  } catch (err) {
    conn.end();
    throw hostKeyFailure ?? mapSshError(err);
  }
  log('info', 'Autenticado');
  return conn;
}
