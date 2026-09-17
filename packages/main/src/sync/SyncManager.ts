import os from 'node:os';
import { safeStorage } from 'electron';
import { v7 as uuidv7 } from 'uuid';
import { SYNC_TYPE_TO_CATEGORY, type SyncCategory, type SyncStatus } from '@vela-ftp/shared';
import { decrypt, deriveKey, encrypt, generateSalt } from 'vela-kit/crypto';
import { logger } from 'vela-kit/logger';
import { applyRemoteEntity, localEntities, type SyncRepositories } from './serializers';
import { syncEvents, type SyncEntityEvent } from './syncEvents';
import type { SyncPendingRepository, SyncStateRepository } from './syncState';

/** Servidor de sincronización. `VELA_SYNC_SERVER` lo cambia para pruebas. */
export const SERVER_URL = process.env.VELA_SYNC_SERVER ?? 'https://sync.vela-browser.com';
const WS_URL = SERVER_URL.replace(/^http/, 'ws');

/** Nombre del perfil remoto: los dispositivos de Vela FTP comparten este. */
const PROFILE_NAME = 'Vela FTP';

const PUSH_BATCH_SIZE = 200;
const PUSH_BATCH_BYTES = 1_200_000;
const PULL_DEBOUNCE_MS = 250;
const MAX_PULL_ROUNDS = 50;
const MAX_RECONNECT_DELAY_MS = 60_000;

interface RemoteEntity {
  id: string;
  entity_type: string;
  data_ct: string | null;
  updated_at: number;
  deleted: number;
}

interface Config {
  sessionToken: string;
  syncKey: Buffer;
  /** Id del perfil EN EL SERVIDOR; nunca un id local. */
  remoteProfileId: string;
  lastSeq: number;
}

export interface SyncManagerDeps {
  state: SyncStateRepository;
  pending: SyncPendingRepository;
  repos: SyncRepositories;
  onStatus: (status: SyncStatus) => void;
  /** Avisa al renderer de que los datos locales han cambiado por sincronización. */
  onDataChanged: () => void;
}

/**
 * Sincronización E2EE contra el servidor de Vela. El servidor solo ve blobs
 * cifrados: la clave se deriva de la contraseña de sincronización y no sale de
 * este dispositivo.
 */
export class SyncManager {
  private config: Config | null = null;
  private ws: WebSocket | null = null;
  private phase: SyncStatus['phase'] = 'off';
  private error: string | null = null;
  private syncing = false;
  private pullAgain = false;
  private pullDebounce: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1_000;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: SyncManagerDeps) {}

  // ── Estado ─────────────────────────────────────────────────────────────────

  status(): SyncStatus {
    return {
      phase: this.phase,
      email: this.deps.state.email(),
      connected: this.ws?.readyState === 1,
      lastSyncAt: this.deps.state.lastSyncAt(),
      pendingChanges: this.deps.pending.count(),
      error: this.error,
      disabledCategories: this.deps.state.disabledCategories() as SyncCategory[],
    };
  }

  private setPhase(phase: SyncStatus['phase'], error: string | null = null): void {
    this.phase = phase;
    this.error = error;
    this.deps.onStatus(this.status());
  }

  private emitStatus(): void {
    this.deps.onStatus(this.status());
  }

  // ── Vinculación ────────────────────────────────────────────────────────────

  /** Pide el enlace mágico para esta app. */
  async requestLink(email: string): Promise<void> {
    const res = await fetch(`${SERVER_URL}/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, app: 'ftp' }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `El servidor respondió ${res.status}`);
    }
    this.deps.state.saveEmail(email);
    this.emitStatus();
  }

  /** Token recibido en `vela-ftp://sync-callback`. Falta la contraseña para la clave. */
  onSessionToken(token: string): void {
    this.deps.state.saveSessionToken(token);
    this.setPhase('needs-password');
    logger.info('[sync] dispositivo vinculado; falta la contraseña de sincronización');
  }

  /** Deriva la clave, registra el perfil y arranca. */
  async activate(password: string): Promise<void> {
    const sessionToken = this.deps.state.sessionToken();
    if (!sessionToken) throw new Error('Este dispositivo no está vinculado a ninguna cuenta');

    this.setPhase('connecting');
    try {
      const salt = await this.fetchCanonicalSalt(sessionToken);
      const syncKey = deriveKey(password, salt);
      const remoteProfileId = await this.resolveRemoteProfile(sessionToken, syncKey);

      const previous = this.deps.state.remoteProfileId();
      const lastSeq = previous === remoteProfileId ? this.deps.state.lastSeq() : 0;

      this.config = { sessionToken, syncKey, remoteProfileId, lastSeq };
      this.deps.state.saveKeySalt(salt);
      this.deps.state.saveRemoteProfileId(remoteProfileId);
      this.deps.state.saveLastSeq(lastSeq);
      this.persistKey(syncKey);

      this.listen();
      await this.registerProfile();
      this.connect();
      // Primero lo de aquí y luego lo de allí: si no, un dispositivo con datos
      // no aporta nada hasta que el usuario toca algo.
      await this.pushAllLocal();
      await this.pullChanges();
      this.setPhase('active');
    } catch (err) {
      this.config = null;
      this.setPhase('error', err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  /** Al arrancar: si ya había clave guardada, sigue sin preguntar nada. */
  async restore(): Promise<void> {
    const sessionToken = this.deps.state.sessionToken();
    if (!sessionToken) return;

    const syncKey = this.readKey();
    const remoteProfileId = this.deps.state.remoteProfileId();
    if (!syncKey || !remoteProfileId) {
      this.setPhase('needs-password');
      return;
    }

    this.config = { sessionToken, syncKey, remoteProfileId, lastSeq: this.deps.state.lastSeq() };
    this.listen();
    this.connect();
    this.setPhase('connecting');
    try {
      await this.pullChanges();
      await this.flushPending();
      this.setPhase('active');
    } catch (err) {
      // Sin red se sigue en marcha: el WebSocket reintenta y la cola espera.
      this.setPhase('active', err instanceof Error ? err.message : String(err));
    }
  }

  /** Desvincula este dispositivo: fuera clave, token y cola. */
  async deactivate(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.disconnect();
    this.config = null;
    this.deps.state.clear();
    this.deps.pending.clearAll();
    this.removeKey();
    this.setPhase('off');
    logger.info('[sync] dispositivo desvinculado');
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.disconnect();
  }

  // ── Categorías ─────────────────────────────────────────────────────────────

  setDisabledCategories(disabled: SyncCategory[]): void {
    const before = new Set(this.deps.state.disabledCategories());
    this.deps.state.saveDisabledCategories(disabled);
    // Al reactivar una categoría hay que releer lo que pasó de largo.
    const reenabled = [...before].some((category) => !disabled.includes(category as SyncCategory));
    if (reenabled && this.config) {
      this.config.lastSeq = 0;
      this.deps.state.saveLastSeq(0);
      void this.pullChanges();
      void this.pushAllLocal();
    }
    this.emitStatus();
  }

  private isEnabled(entityType: string): boolean {
    const category = SYNC_TYPE_TO_CATEGORY[entityType];
    // Un tipo sin categoría se sincroniza: no dejamos datos fuera por olvido.
    if (!category) return true;
    return !this.deps.state.disabledCategories().includes(category);
  }

  // ── Servidor ───────────────────────────────────────────────────────────────

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.config) throw new Error('La sincronización no está activa');
    const res = await fetch(`${SERVER_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.sessionToken}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`${path} respondió ${res.status}`);
    return (await res.json()) as T;
  }

  /** El salt lo custodia el servidor: con salts distintos, la misma contraseña daría claves distintas. */
  private async fetchCanonicalSalt(sessionToken: string): Promise<Buffer> {
    const res = await fetch(`${SERVER_URL}/sync/key-salt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ salt: generateSalt().toString('hex') }),
    });
    if (!res.ok) throw new Error(`No se pudo obtener el salt: ${res.status}`);
    const { salt } = (await res.json()) as { salt: string };
    return Buffer.from(salt, 'hex');
  }

  /**
   * Perfil remoto de Vela FTP: el que ya exista con ese nombre (lo reconocemos
   * al descifrarlo) o uno nuevo. Los perfiles de Vela Browser quedan aparte.
   */
  private async resolveRemoteProfile(sessionToken: string, syncKey: Buffer): Promise<string> {
    const res = await fetch(`${SERVER_URL}/sync/profiles`, { headers: { Authorization: `Bearer ${sessionToken}` } });
    if (!res.ok) throw new Error(`No se pudieron listar los perfiles: ${res.status}`);
    const { profiles } = (await res.json()) as { profiles: Array<{ id: string; name_ct: string }> };

    for (const profile of profiles) {
      try {
        const plain = decrypt(Buffer.from(profile.name_ct, 'base64'), syncKey).toString('utf-8');
        const parsed = JSON.parse(plain) as { app?: string };
        if (parsed.app === 'vela-ftp') return profile.id;
      } catch {
        // De otra app o cifrado con otra contraseña: no es el nuestro.
      }
    }
    return uuidv7();
  }

  private async registerProfile(): Promise<void> {
    if (!this.config) return;
    // El nombre viaja cifrado: el servidor no distingue una app de otra.
    const payload = JSON.stringify({ app: 'vela-ftp', name: PROFILE_NAME, host: os.hostname() });
    await this.request('/sync/profiles', {
      method: 'POST',
      body: JSON.stringify({ id: this.config.remoteProfileId, name_ct: encrypt(payload, this.config.syncKey).toString('base64') }),
    });
  }

  // ── WebSocket ──────────────────────────────────────────────────────────────

  private connect(): void {
    if (!this.config) return;
    this.ws = new WebSocket(WS_URL);

    this.ws.addEventListener('open', () => {
      this.reconnectDelay = 1_000;
      this.ws?.send(JSON.stringify({ token: this.config?.sessionToken }));
      this.emitStatus();
      void this.flushPending();
    });

    this.ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as { type?: string; profile_id?: string };
        if (msg.type !== 'sync:changes') return;
        if (msg.profile_id && msg.profile_id !== this.config?.remoteProfileId) return;
        this.schedulePull();
      } catch {
        // Mensaje malformado: nada que hacer.
      }
    });

    this.ws.addEventListener('close', () => {
      this.ws = null;
      this.emitStatus();
      this.scheduleReconnect();
    });

    this.ws.addEventListener('error', () => {
      // El cierre llega detrás y es quien reprograma la reconexión.
    });
  }

  private scheduleReconnect(): void {
    if (!this.config || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.config) this.connect();
    }, delay);
  }

  private disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.pullDebounce) clearTimeout(this.pullDebounce);
    this.pullDebounce = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  private isConnected(): boolean {
    return this.ws?.readyState === 1;
  }

  // ── Envío ──────────────────────────────────────────────────────────────────

  private listen(): void {
    this.unsubscribe?.();
    this.unsubscribe = syncEvents.onChange((event) => {
      void this.pushChange(event);
    });
  }

  private async pushChange(event: SyncEntityEvent): Promise<void> {
    if (!this.config || !this.isEnabled(event.type)) return;
    const dataJson = event.data ? JSON.stringify(event.data) : null;

    if (!this.isConnected()) {
      this.deps.pending.upsert(event.type, event.id, dataJson, event.updatedAt);
      this.emitStatus();
      return;
    }

    try {
      await this.pushEntities([this.toRemote(event.type, event.id, dataJson, event.updatedAt)]);
    } catch (err) {
      // Un fallo de red no puede perder el cambio: a la cola, como si no hubiera red.
      logger.warn(`[sync] no se pudo enviar ${event.type}/${event.id}; encolado`, err);
      this.deps.pending.upsert(event.type, event.id, dataJson, event.updatedAt);
      this.emitStatus();
    }
  }

  private toRemote(type: string, id: string, dataJson: string | null, updatedAt: number): RemoteEntity {
    return {
      id,
      entity_type: type,
      data_ct: dataJson ? encrypt(dataJson, this.config!.syncKey).toString('base64') : null,
      updated_at: updatedAt,
      deleted: dataJson === null ? 1 : 0,
    };
  }

  private async pushEntities(entities: RemoteEntity[]): Promise<void> {
    if (!this.config || entities.length === 0) return;
    for (const batch of splitIntoBatches(entities)) {
      await this.request('/sync/entities', {
        method: 'PUT',
        body: JSON.stringify({ profile_id: this.config.remoteProfileId, entities: batch }),
      });
    }
  }

  /** Sube todo lo que ya había en este dispositivo (al vincular). */
  async pushAllLocal(): Promise<void> {
    if (!this.config) return;
    const entities = localEntities(this.deps.repos)
      .filter((entity) => this.isEnabled(entity.type))
      .map((entity) => this.toRemote(entity.type, entity.id, JSON.stringify(entity.data), entity.updatedAt));
    if (entities.length === 0) return;
    await this.pushEntities(entities);
    logger.info(`[sync] enviadas ${entities.length} entidades locales`);
  }

  private async flushPending(): Promise<void> {
    if (!this.config || !this.isConnected()) return;
    const pending = this.deps.pending.listAll().filter((p) => this.isEnabled(p.entity_type));
    if (pending.length === 0) return;
    try {
      await this.pushEntities(pending.map((p) => this.toRemote(p.entity_type, p.entity_id, p.data_json, p.updated_at)));
      this.deps.pending.clearAll();
      this.emitStatus();
    } catch (err) {
      logger.warn('[sync] la cola pendiente no pudo vaciarse', err);
    }
  }

  // ── Bajada ─────────────────────────────────────────────────────────────────

  private schedulePull(): void {
    if (this.pullDebounce) clearTimeout(this.pullDebounce);
    this.pullDebounce = setTimeout(() => {
      this.pullDebounce = null;
      void this.pullChanges();
    }, PULL_DEBOUNCE_MS);
  }

  /** Baja lo pendiente. Nunca reentra: encadena las vueltas en un bucle. */
  async pullChanges(): Promise<void> {
    if (!this.config) return;
    if (this.syncing) {
      this.pullAgain = true;
      return;
    }
    this.syncing = true;
    try {
      let rounds = 0;
      do {
        this.pullAgain = false;
        while ((await this.pullOnce()) && ++rounds < MAX_PULL_ROUNDS);
      } while (this.pullAgain && ++rounds < MAX_PULL_ROUNDS);
      this.deps.state.saveLastSyncAt(Date.now());
    } finally {
      this.syncing = false;
      this.emitStatus();
    }
  }

  /** Devuelve true si el servidor dice que quedan más páginas. */
  private async pullOnce(): Promise<boolean> {
    if (!this.config) return false;
    const { entities, current_seq, has_more } = await this.request<{
      entities: RemoteEntity[];
      current_seq: number;
      has_more?: boolean;
    }>(`/sync/entities?profile_id=${encodeURIComponent(this.config.remoteProfileId)}&since_seq=${this.config.lastSeq}`);

    let changed = false;
    for (const entity of entities) {
      if (!this.isEnabled(entity.entity_type)) continue;
      let data: object | null = null;
      if (!entity.deleted && entity.data_ct) {
        try {
          data = JSON.parse(decrypt(Buffer.from(entity.data_ct, 'base64'), this.config.syncKey).toString('utf-8')) as object;
        } catch {
          // Cifrado con otra contraseña: no se toca nada local.
          logger.warn(`[sync] no se pudo descifrar ${entity.entity_type}/${entity.id}`);
          continue;
        }
      }
      if (applyRemoteEntity(this.deps.repos, entity.entity_type, entity.id, data, entity.updated_at)) changed = true;
    }

    this.config.lastSeq = current_seq;
    this.deps.state.saveLastSeq(current_seq);
    if (changed) this.deps.onDataChanged();
    return has_more === true;
  }

  /** Sincronización a petición del usuario. */
  async syncNow(): Promise<void> {
    if (!this.config) throw new Error('La sincronización no está activa');
    await this.flushPending();
    await this.pullChanges();
  }

  // ── Clave en reposo ────────────────────────────────────────────────────────

  private persistKey(key: Buffer): void {
    try {
      if (!safeStorage.isEncryptionAvailable()) return;
      this.deps.state.saveSyncKey(safeStorage.encryptString(key.toString('hex')).toString('base64'));
    } catch (err) {
      // Sin llavero se vuelve a pedir la contraseña en cada arranque.
      logger.warn('[sync] no se pudo guardar la clave de sincronización', err);
    }
  }

  private readKey(): Buffer | null {
    const stored = this.deps.state.syncKey();
    if (!stored) return null;
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      return Buffer.from(safeStorage.decryptString(Buffer.from(stored, 'base64')), 'hex');
    } catch {
      return null;
    }
  }

  private removeKey(): void {
    this.deps.state.clearSyncKey();
  }
}

function splitIntoBatches(entities: RemoteEntity[]): RemoteEntity[][] {
  const batches: RemoteEntity[][] = [];
  let current: RemoteEntity[] = [];
  let bytes = 0;
  for (const entity of entities) {
    const size = (entity.data_ct?.length ?? 0) + entity.id.length + 100;
    if (current.length > 0 && (current.length >= PUSH_BATCH_SIZE || bytes + size > PUSH_BATCH_BYTES)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(entity);
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
