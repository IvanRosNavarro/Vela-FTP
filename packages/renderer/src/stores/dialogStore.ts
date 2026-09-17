import { create } from 'zustand';
import type { ConflictInfo, Site } from '@vela-ftp/shared';

export type DialogSpec =
  | { kind: 'confirm'; title: string; message: string; confirmLabel: string; danger: boolean; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; title: string; label: string; initial: string; confirmLabel: string; validate: (v: string) => string | null; resolve: (value: string | null) => void }
  | { kind: 'siteEditor'; site: Site | null }
  | {
      kind: 'hostKey';
      reason: 'HOST_KEY_UNKNOWN' | 'HOST_KEY_MISMATCH' | 'CERT_UNTRUSTED';
      host: string;
      port: number;
      details: Record<string, string | number | boolean | null>;
      resolve: (accepted: boolean) => void;
    }
  | { kind: 'unlock'; resolve: (unlocked: boolean) => void }
  | { kind: 'masterPassword' }
  | { kind: 'conflict'; info: ConflictInfo }
  | { kind: 'chmod'; sessionId: string; path: string; mode: number | null };

type WithoutResolve<T> = T extends { resolve: unknown } ? Omit<T, 'resolve'> : T;

interface DialogState {
  /** Pila: el último es el visible. */
  stack: DialogSpec[];
  open(spec: DialogSpec): void;
  close(spec: DialogSpec): void;
}

export const useDialogStore = create<DialogState>((set) => ({
  stack: [],
  open: (spec) => set((s) => ({ stack: [...s.stack, spec] })),
  close: (spec) => set((s) => ({ stack: s.stack.filter((d) => d !== spec) })),
}));

/** Diálogo de confirmación propio (nada de `confirm()`). */
export function confirmDialog(options: Omit<WithoutResolve<Extract<DialogSpec, { kind: 'confirm' }>>, 'kind'>): Promise<boolean> {
  return new Promise((resolve) => useDialogStore.getState().open({ kind: 'confirm', ...options, resolve }));
}

export function promptDialog(options: Omit<WithoutResolve<Extract<DialogSpec, { kind: 'prompt' }>>, 'kind'>): Promise<string | null> {
  return new Promise((resolve) => useDialogStore.getState().open({ kind: 'prompt', ...options, resolve }));
}
