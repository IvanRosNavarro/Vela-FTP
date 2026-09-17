import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

/** Modal DOM con foco atrapado y Escape para cerrar. */
export function Modal({ title, onClose, children, footer, width = 440 }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button');
    first?.focus();
    return () => previous?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const focusable = [...ref.current.querySelectorAll<HTMLElement>('input, select, textarea, button:not(:disabled)')];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center bg-black/50 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={onKeyDown}
        style={{ width }}
        className="flex max-h-[76vh] max-w-[92vw] flex-col overflow-hidden rounded-[var(--vela-radius-lg)] border border-[var(--vela-border)] bg-[var(--vela-bg-elevated)] shadow-2xl"
      >
        <header className="border-b border-[var(--vela-border)] px-4 py-3 text-sm font-semibold">{title}</header>
        <div className="flex-1 overflow-auto px-4 py-3 text-xs">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-[var(--vela-border)] px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}
