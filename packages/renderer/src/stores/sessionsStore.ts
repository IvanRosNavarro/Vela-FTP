import { create } from 'zustand';
import type { SessionInfo } from '@vela-ftp/shared';
import { toast } from 'vela-kit/ui';
import { AppError, call, errorText } from '../lib/ipc';
import { useDialogStore } from './dialogStore';
import { localPaneKey, remotePaneKey, usePanesStore } from './panesStore';
import { useSitesStore } from './sitesStore';
import { useTerminalsStore } from './terminalsStore';

interface SessionsState {
  sessions: SessionInfo[];
  activeId: string | null;
  /** Sitio en proceso de conexión. */
  connecting: string | null;
  connect(siteId: string): Promise<void>;
  disconnect(sessionId: string): Promise<void>;
  /** Sesión abierta del sitio, conectando si no hay ninguna. null si el usuario cancela o falla. */
  ensureSession(siteId: string): Promise<string | null>;
  activate(sessionId: string): void;
  /** La conexión se cayó: se quita la sesión del estado local. */
  markLost(sessionId: string): void;
}

const HOST_KEY_ERRORS = new Set(['HOST_KEY_UNKNOWN', 'HOST_KEY_MISMATCH', 'CERT_UNTRUSTED']);

function askHostKey(err: AppError, host: string, port: number): Promise<boolean> {
  return new Promise((resolve) =>
    useDialogStore.getState().open({
      kind: 'hostKey',
      reason: err.code as 'HOST_KEY_UNKNOWN' | 'HOST_KEY_MISMATCH' | 'CERT_UNTRUSTED',
      host,
      port,
      details: err.transferDetails ?? {},
      resolve,
    }),
  );
}

function askUnlock(): Promise<boolean> {
  return new Promise((resolve) => useDialogStore.getState().open({ kind: 'unlock', resolve }));
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  activeId: null,
  connecting: null,

  async connect(siteId) {
    const site = useSitesStore.getState().sites.find((s) => s.id === siteId);
    if (!site || get().connecting) return;
    const previousActive = get().activeId;
    set({ connecting: siteId });
    try {
      // Hasta 3 vueltas: desbloquear secretos y confirmar huella, cada una una vez.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const info = await call(window.api.sessions.open(siteId));
          const key = remotePaneKey(info.sessionId);
          usePanesStore.getState().ensure(key, info.startPath);
          set((s) => ({ sessions: [...s.sessions, info], activeId: info.sessionId }));
          const ok = await usePanesStore.getState().navigate(key, info.startPath);
          if (!ok && info.startPath !== '/') {
            toast(`No se pudo abrir ${info.startPath}; se muestra la raíz`, 'warning');
            await usePanesStore.getState().navigate(key, '/');
          }
          // Carpeta local de esta pestaña: la del sitio, o la que se esté viendo ahora.
          const panes = usePanesStore.getState();
          const current = panes.panes[localPaneKey(previousActive)]?.path ?? panes.panes.local?.path;
          const startLocal = info.localStartPath ?? current;
          if (startLocal) {
            const localKey = localPaneKey(info.sessionId);
            panes.ensure(localKey, startLocal);
            await panes.navigate(localKey, startLocal);
          }
          toast(`Conectado a ${site.name}`, 'success');
          return;
        } catch (err) {
          if (!(err instanceof AppError)) throw err;
          if (err.code === 'VAULT_LOCKED') {
            if (!(await askUnlock())) return;
            continue;
          }
          if (HOST_KEY_ERRORS.has(err.code)) {
            if (!(await askHostKey(err, site.host, site.port))) return;
            continue;
          }
          throw err;
        }
      }
    } catch (err) {
      toast(`${site.name}: ${errorText(err)}`, 'error');
    } finally {
      set({ connecting: null });
    }
  },

  async disconnect(sessionId) {
    try {
      await call(window.api.sessions.close(sessionId));
    } catch {
      // Si el motor ya no la tenía, se quita igual.
    }
    get().markLost(sessionId);
  },

  async ensureSession(siteId) {
    const existing = get().sessions.find((s) => s.siteId === siteId);
    if (existing) return existing.sessionId;
    await get().connect(siteId);
    return get().sessions.find((s) => s.siteId === siteId)?.sessionId ?? null;
  },

  activate: (sessionId) => set({ activeId: sessionId }),

  markLost(sessionId) {
    useTerminalsStore.getState().closeSession(sessionId);
    usePanesStore.getState().drop(remotePaneKey(sessionId));
    usePanesStore.getState().drop(localPaneKey(sessionId));
    set((s) => {
      const sessions = s.sessions.filter((x) => x.sessionId !== sessionId);
      const activeId = s.activeId === sessionId ? (sessions.at(-1)?.sessionId ?? null) : s.activeId;
      return { sessions, activeId };
    });
  },
}));
