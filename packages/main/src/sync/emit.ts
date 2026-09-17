import { syncEvents } from './syncEvents';

/** Cambio local listo para viajar. Lo llaman los repositorios tras mutar. */
export function emitEntity(type: string, id: string, data: object, updatedAt: number): void {
  syncEvents.emitChange({ type, id, data, updatedAt });
}

/** Borrado local: el resto de dispositivos debe borrarlo también. */
export function emitEntityDeleted(type: string, id: string, updatedAt = Date.now()): void {
  syncEvents.emitChange({ type, id, data: null, updatedAt });
}
