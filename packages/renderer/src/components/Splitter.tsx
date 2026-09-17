import { useRef } from 'react';

interface SplitterProps {
  direction: 'horizontal' | 'vertical';
  /** Tamaño actual del panel que se redimensiona. */
  value: number;
  min: number;
  max: number;
  /** true si el panel crece al mover hacia arriba/izquierda (panel inferior). */
  invert?: boolean;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}

/** Barra para arrastrar y redimensionar un panel. */
export function Splitter({ direction, value, min, max, invert = false, onChange, onCommit }: SplitterProps) {
  const start = useRef<{ pos: number; value: number } | null>(null);
  const latest = useRef(value);
  const vertical = direction === 'vertical';

  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'horizontal' : 'vertical'}
      aria-valuenow={value}
      className={`shrink-0 bg-transparent transition-colors hover:bg-[var(--vela-accent)] ${vertical ? 'h-1 cursor-row-resize' : 'w-1 cursor-col-resize'}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { pos: vertical ? e.clientY : e.clientX, value };
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const delta = (vertical ? e.clientY : e.clientX) - start.current.pos;
        const next = Math.round(Math.max(min, Math.min(max, start.current.value + (invert ? -delta : delta))));
        latest.current = next;
        onChange(next);
      }}
      onPointerUp={() => {
        if (start.current) onCommit(latest.current);
        start.current = null;
      }}
    />
  );
}
