import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { transaction } from 'vela-kit/storage';

/** Envoltura de la clave de datos con el llavero del SO (`safeStorage` en la app). */
export interface KeychainWrapper {
  isAvailable(): boolean;
  encrypt(plain: Buffer): Buffer;
  decrypt(cipher: Buffer): Buffer;
}

export type VaultMode = 'keychain' | 'master-password';

export interface VaultStatus {
  mode: VaultMode | 'uninitialized';
  locked: boolean;
  keychainAvailable: boolean;
}

export class VaultLockedError extends Error {
  constructor() {
    super('Los secretos están bloqueados: hace falta la contraseña maestra');
    this.name = 'VaultLockedError';
  }
}

export class InvalidMasterPasswordError extends Error {
  constructor() {
    super('Contraseña maestra incorrecta');
    this.name = 'InvalidMasterPasswordError';
  }
}

export class KeychainUnavailableError extends Error {
  constructor() {
    super('El llavero del sistema no está disponible: establece una contraseña maestra');
    this.name = 'KeychainUnavailableError';
  }
}

const FORMAT_VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

// scrypt con los parámetros recomendados por OWASP (N=2^17, r=8, p=1). Argon2id
// no está disponible: el crypto de Electron usa BoringSSL, que no lo implementa.
export interface KdfParams {
  N: number;
  r: number;
  p: number;
}
export const DEFAULT_KDF: KdfParams = { N: 2 ** 17, r: 8, p: 1 };

const META = {
  mode: 'secrets:mode',
  wrappedKey: 'secrets:wrapped-key',
  salt: 'secrets:kdf-salt',
  kdf: 'secrets:kdf-params',
} as const;

function aesEncrypt(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, cipher.getAuthTag(), body]);
}

function aesDecrypt(key: Buffer, blob: Buffer): Buffer {
  if (blob[0] !== FORMAT_VERSION) throw new Error(`Formato de cifrado desconocido: ${blob[0]}`);
  const iv = blob.subarray(1, 1 + IV_LENGTH);
  const tag = blob.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
  const body = blob.subarray(1 + IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

function deriveKey(password: string, salt: Buffer, params: KdfParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, 32, { ...params, maxmem: 256 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/**
 * Cifra los secretos de la app (contraseñas, passphrases) con AES-256-GCM y una
 * clave de datos aleatoria. La clave de datos se guarda envuelta: por el
 * llavero del SO, o por una contraseña maestra (scrypt). En claro solo
 * existe en memoria y se borra al bloquear.
 */
export class SecretStore {
  private dataKey: Buffer | null = null;

  constructor(
    private readonly db: DatabaseSync,
    private readonly keychain: KeychainWrapper,
    private readonly kdf: KdfParams = DEFAULT_KDF,
  ) {}

  private getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM app_metadata WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO app_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  private deleteMeta(key: string): void {
    this.db.prepare('DELETE FROM app_metadata WHERE key = ?').run(key);
  }

  status(): VaultStatus {
    const mode = this.getMeta(META.mode) as VaultMode | null;
    return {
      mode: mode ?? 'uninitialized',
      locked: mode === 'master-password' && this.dataKey === null,
      keychainAvailable: this.keychain.isAvailable(),
    };
  }

  /**
   * Prepara el almacén al arrancar: con llavero, desbloquea solo; sin
   * inicializar, crea la clave con el llavero si está disponible.
   */
  initialize(): void {
    const mode = this.getMeta(META.mode) as VaultMode | null;
    if (mode === 'keychain') {
      const wrapped = Buffer.from(this.getMeta(META.wrappedKey) ?? '', 'base64');
      this.dataKey = this.keychain.decrypt(wrapped);
      return;
    }
    if (mode === null && this.keychain.isAvailable()) {
      const key = randomBytes(32);
      this.setMeta(META.wrappedKey, this.keychain.encrypt(key).toString('base64'));
      this.setMeta(META.mode, 'keychain');
      this.dataKey = key;
    }
  }

  async unlock(password: string): Promise<void> {
    if (this.getMeta(META.mode) !== 'master-password') return;
    const salt = Buffer.from(this.getMeta(META.salt) ?? '', 'base64');
    const params = JSON.parse(this.getMeta(META.kdf) ?? 'null') as KdfParams;
    const derived = await deriveKey(password, salt, params);
    const wrapped = Buffer.from(this.getMeta(META.wrappedKey) ?? '', 'base64');
    try {
      this.dataKey = aesDecrypt(derived, wrapped);
    } catch {
      throw new InvalidMasterPasswordError();
    }
  }

  lock(): void {
    if (this.getMeta(META.mode) !== 'master-password') return;
    this.dataKey?.fill(0);
    this.dataKey = null;
  }

  /**
   * Establece, cambia o quita (`next = null`) la contraseña maestra. Con una ya
   * puesta hace falta la actual. Los secretos no se re-cifran: solo cambia cómo
   * se guarda la clave de datos.
   */
  async setMasterPassword(current: string | null, next: string | null): Promise<void> {
    const mode = this.getMeta(META.mode) as VaultMode | null;
    if (mode === 'master-password') {
      if (current === null) throw new InvalidMasterPasswordError();
      await this.unlock(current);
    }
    if (!this.dataKey) {
      if (mode !== null) throw new VaultLockedError();
      this.dataKey = randomBytes(32);
    }

    if (next === null) {
      if (!this.keychain.isAvailable()) throw new KeychainUnavailableError();
      const wrapped = this.keychain.encrypt(this.dataKey);
      transaction(this.db, () => {
        this.setMeta(META.wrappedKey, wrapped.toString('base64'));
        this.setMeta(META.mode, 'keychain');
        this.deleteMeta(META.salt);
        this.deleteMeta(META.kdf);
      });
      return;
    }

    const salt = randomBytes(16);
    const wrapped = aesEncrypt(await deriveKey(next, salt, this.kdf), this.dataKey);
    // Todo o nada: una clave envuelta sin su sal dejaría los secretos perdidos.
    transaction(this.db, () => {
      this.setMeta(META.salt, salt.toString('base64'));
      this.setMeta(META.kdf, JSON.stringify(this.kdf));
      this.setMeta(META.wrappedKey, wrapped.toString('base64'));
      this.setMeta(META.mode, 'master-password');
    });
  }

  private key(): Buffer {
    if (!this.dataKey) {
      if (this.getMeta(META.mode) === null) throw new KeychainUnavailableError();
      throw new VaultLockedError();
    }
    return this.dataKey;
  }

  encrypt(plain: string): Buffer {
    return aesEncrypt(this.key(), Buffer.from(plain, 'utf8'));
  }

  decrypt(blob: Uint8Array): string {
    return aesDecrypt(this.key(), Buffer.from(blob)).toString('utf8');
  }
}
