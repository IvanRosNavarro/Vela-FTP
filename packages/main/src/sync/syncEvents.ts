import { EventEmitter } from 'node:events';

/** Cambio local que debe viajar al resto de dispositivos. `data` nulo = borrado. */
export interface SyncEntityEvent {
  type: string;
  id: string;
  data: object | null;
  updatedAt: number;
}

/**
 * Los repositorios emiten aquí; `SyncManager` escucha. Así ninguno depende de
 * la sincronización ni habla con el servidor.
 */
class SyncEventBus extends EventEmitter {
  emitChange(event: SyncEntityEvent): void {
    this.emit('entity:changed', event);
  }

  onChange(listener: (event: SyncEntityEvent) => void): () => void {
    this.on('entity:changed', listener);
    return () => {
      this.off('entity:changed', listener);
    };
  }
}

export const syncEvents = new SyncEventBus();
