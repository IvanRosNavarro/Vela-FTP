import { describe, expect, it } from 'vitest';
import { createTestDb } from '../test/createTestDb';
import {
  InvalidMasterPasswordError,
  KeychainUnavailableError,
  SecretStore,
  VaultLockedError,
  type KeychainWrapper,
} from './SecretStore';

// KDF barata para que los tests vayan rápido; la real usa N=2^17.
const FAST_KDF = { N: 1024, r: 8, p: 1 };

function fakeKeychain(available = true): KeychainWrapper {
  const mask = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a));
  return { isAvailable: () => available, encrypt: mask, decrypt: mask };
}

describe('SecretStore', () => {
  it('con llavero se inicializa y cifra sin intervención', () => {
    const db = createTestDb();
    const store = new SecretStore(db, fakeKeychain(), FAST_KDF);
    store.initialize();
    expect(store.status()).toEqual({ mode: 'keychain', locked: false, keychainAvailable: true });

    const blob = store.encrypt('contraseña ñ');
    expect(blob.toString('utf8')).not.toContain('contraseña');
    expect(store.decrypt(blob)).toBe('contraseña ñ');

    // Tras reiniciar la app, la misma clave sale del llavero.
    const again = new SecretStore(db, fakeKeychain(), FAST_KDF);
    again.initialize();
    expect(again.decrypt(blob)).toBe('contraseña ñ');
  });

  it('detecta manipulaciones del texto cifrado', () => {
    const store = new SecretStore(createTestDb(), fakeKeychain(), FAST_KDF);
    store.initialize();
    const blob = store.encrypt('secreto');
    blob[blob.length - 1] ^= 1;
    expect(() => store.decrypt(blob)).toThrow();
  });

  it('con contraseña maestra se bloquea y se desbloquea', async () => {
    const db = createTestDb();
    const store = new SecretStore(db, fakeKeychain(), FAST_KDF);
    store.initialize();
    const blob = store.encrypt('ftp-pass');
    await store.setMasterPassword(null, 'maestra-larga');
    expect(store.status().mode).toBe('master-password');

    // Arranque en frío: bloqueado hasta dar la contraseña.
    const cold = new SecretStore(db, fakeKeychain(), FAST_KDF);
    cold.initialize();
    expect(cold.status().locked).toBe(true);
    expect(() => cold.decrypt(blob)).toThrow(VaultLockedError);
    await expect(cold.unlock('otra')).rejects.toThrow(InvalidMasterPasswordError);
    await cold.unlock('maestra-larga');
    expect(cold.decrypt(blob)).toBe('ftp-pass');
    cold.lock();
    expect(() => cold.encrypt('x')).toThrow(VaultLockedError);
  });

  it('cambiar o quitar la contraseña maestra conserva los secretos', async () => {
    const db = createTestDb();
    const store = new SecretStore(db, fakeKeychain(), FAST_KDF);
    store.initialize();
    const blob = store.encrypt('dato');
    await store.setMasterPassword(null, 'primera-clave');
    await expect(store.setMasterPassword('mala', 'segunda-clave')).rejects.toThrow(InvalidMasterPasswordError);
    await store.setMasterPassword('primera-clave', 'segunda-clave');
    await store.setMasterPassword('segunda-clave', null);

    const cold = new SecretStore(db, fakeKeychain(), FAST_KDF);
    cold.initialize();
    expect(cold.status()).toMatchObject({ mode: 'keychain', locked: false });
    expect(cold.decrypt(blob)).toBe('dato');
  });

  it('sin llavero exige contraseña maestra', async () => {
    const store = new SecretStore(createTestDb(), fakeKeychain(false), FAST_KDF);
    store.initialize();
    expect(store.status()).toEqual({ mode: 'uninitialized', locked: false, keychainAvailable: false });
    expect(() => store.encrypt('x')).toThrow(KeychainUnavailableError);
    await store.setMasterPassword(null, 'sin-llavero-1');
    expect(store.decrypt(store.encrypt('ok'))).toBe('ok');
    await expect(store.setMasterPassword('sin-llavero-1', null)).rejects.toThrow(KeychainUnavailableError);
  });
});
