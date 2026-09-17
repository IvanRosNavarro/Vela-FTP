import { readFile } from 'node:fs/promises';
import { v7 as uuidv7 } from 'uuid';
import type { ConnectionConfig, SessionInfo } from '@vela-ftp/shared';
import { logger } from 'vela-kit/logger';
import type { KnownHostsRepository } from '../storage/repositories/KnownHostsRepository';
import type { SitesRepository } from '../storage/repositories/SitesRepository';
import { TransferRequestError, type TransferHost } from '../transfer/TransferHost';

/** Abre y cierra sesiones del motor a partir de los sitios guardados. */
export class SessionManager {
  private readonly sessions = new Map<string, SessionInfo>();

  constructor(
    private readonly transfer: TransferHost,
    private readonly sites: SitesRepository,
    private readonly knownHosts: KnownHostsRepository,
  ) {
    transfer.on('session.lost', ({ sessionId }) => {
      logger.warn(`[sessions] conexión de navegación perdida en ${sessionId}`);
    });
    // Si el motor se reinicia, sus sesiones ya no existen.
    transfer.on('host.restarted', () => this.sessions.clear());
  }

  get(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /** Construye la configuración con los secretos descifrados; solo vive en memoria. */
  async buildConfig(siteId: string): Promise<{ config: ConnectionConfig; maxConnections: number }> {
    const site = this.sites.get(siteId);
    const config: ConnectionConfig = {
      protocol: site.protocol,
      host: site.host,
      port: site.port,
      username: site.username,
      auth: site.auth,
      trustedFingerprints: this.knownHosts.fingerprintsFor(site.host, site.port),
    };
    if (site.auth === 'password') config.password = this.sites.getSecret(site.id, 'password') ?? '';
    if (site.auth === 'key' && site.keyPath) {
      try {
        config.privateKey = await readFile(site.keyPath, 'utf8');
      } catch (err) {
        throw new TransferRequestError({
          code: 'NOT_FOUND',
          message: `No se puede leer la clave privada: ${site.keyPath}`,
          details: { local: true, reason: (err as Error).message },
        });
      }
      const passphrase = this.sites.getSecret(site.id, 'passphrase');
      if (passphrase) config.passphrase = passphrase;
    }
    return { config, maxConnections: site.maxConnections };
  }

  async open(siteId: string): Promise<SessionInfo> {
    const site = this.sites.get(siteId);
    const { config, maxConnections } = await this.buildConfig(siteId);
    const sessionId = uuidv7();
    const { homePath } = await this.transfer.request('session.open', {
      sessionId,
      config,
      maxTransferConnections: maxConnections,
    });
    const info: SessionInfo = {
      sessionId,
      siteId: site.id,
      siteName: site.name,
      protocol: site.protocol,
      host: site.host,
      startPath: site.initialRemotePath ?? homePath,
      localStartPath: site.initialLocalPath,
    };
    this.sessions.set(sessionId, info);
    logger.info(`[sessions] abierta ${sessionId} (${site.protocol}://${site.host}:${site.port})`);
    return info;
  }

  async close(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    await this.transfer.request('session.close', { sessionId });
  }
}
