import { safeStorage } from 'electron';
import type { KeychainWrapper } from './SecretStore';

/**
 * Llavero del SO vía `safeStorage` (DPAPI en Windows, Keychain en macOS,
 * libsecret/kwallet en Linux). En Linux sin llavero Electron cae a una clave
 * fija ("basic_text"): eso no protege nada, así que se trata como no disponible
 * y se exige contraseña maestra.
 */
export const osKeychain: KeychainWrapper = {
  isAvailable() {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform === 'linux') return safeStorage.getSelectedStorageBackend() !== 'basic_text';
    return true;
  },
  encrypt(plain) {
    return safeStorage.encryptString(plain.toString('base64'));
  },
  decrypt(cipher) {
    return Buffer.from(safeStorage.decryptString(cipher), 'base64');
  },
};
