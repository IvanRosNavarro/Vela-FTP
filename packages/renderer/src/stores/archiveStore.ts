import { create } from 'zustand';
import type { ArchivePhase, ArchiveProgress } from '@vela-ftp/shared';

export interface ArchiveOp {
  id: string;
  /** «Extrayendo «web.zip»», «Comprimiendo «web.zip»». */
  label: string;
  phase: ArchivePhase | null;
  done: number;
  total: number | null;
  cancelling: boolean;
}

interface ArchiveState {
  ops: ArchiveOp[];
  start(id: string, label: string): void;
  progress(p: ArchiveProgress): void;
  markCancelling(id: string): void;
  finish(id: string): void;
}

/** Extracciones y compresiones de esta ventana que siguen en marcha. */
export const useArchiveStore = create<ArchiveState>((set) => ({
  ops: [],
  start: (id, label) => set((s) => ({ ops: [...s.ops, { id, label, phase: null, done: 0, total: null, cancelling: false }] })),
  progress: ({ opId, phase, done, total }) => set((s) => ({ ops: s.ops.map((op) => (op.id === opId ? { ...op, phase, done, total } : op)) })),
  markCancelling: (id) => set((s) => ({ ops: s.ops.map((op) => (op.id === id ? { ...op, cancelling: true } : op)) })),
  finish: (id) => set((s) => ({ ops: s.ops.filter((op) => op.id !== id) })),
}));
