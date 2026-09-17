import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';

export type MenuItem =
  | { kind?: 'item'; label: string; icon?: ReactNode; shortcut?: string; danger?: boolean; disabled?: boolean; onSelect: () => void }
  | { kind: 'separator' };

interface MenuState {
  menu: { x: number; y: number; items: MenuItem[] } | null;
  show(x: number, y: number, items: MenuItem[]): void;
  hide(): void;
}

export const useContextMenu = create<MenuState>((set) => ({
  menu: null,
  show: (x, y, items) => set({ menu: { x, y, items } }),
  hide: () => set({ menu: null }),
}));

/** Menú contextual DOM (sin WebContentsView no hace falta una ventana nativa). */
export function ContextMenuHost() {
  const menu = useContextMenu((s) => s.menu);
  const hide = useContextMenu((s) => s.hide);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [active, setActive] = useState(-1);

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPos({
      left: Math.min(menu.x, window.innerWidth - rect.width - 4),
      top: Math.min(menu.y, window.innerHeight - rect.height - 4),
    });
    setActive(-1);
    ref.current.focus();
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = () => hide();
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [menu, hide]);

  if (!menu) return null;
  const selectable = menu.items.map((item, i) => (item.kind !== 'separator' && !item.disabled ? i : -1)).filter((i) => i >= 0);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      hide();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = selectable.indexOf(active);
      const next = e.key === 'ArrowDown' ? selectable[(idx + 1) % selectable.length] : selectable[(idx - 1 + selectable.length) % selectable.length];
      setActive(next ?? -1);
    } else if (e.key === 'Enter' && active >= 0) {
      const item = menu.items[active];
      if (item && item.kind !== 'separator') {
        hide();
        item.onSelect();
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[300]" onMouseDown={hide} onContextMenu={(e) => (e.preventDefault(), hide())}>
      <div
        ref={ref}
        role="menu"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}
        className="absolute min-w-[200px] rounded-[var(--vela-radius-md)] border border-[var(--vela-border)] bg-[var(--vela-bg-elevated)] py-1 text-xs shadow-2xl outline-none"
      >
        {menu.items.map((item, i) =>
          item.kind === 'separator' ? (
            <div key={i} className="my-1 border-t border-[var(--vela-border)]" />
          ) : (
            <button
              key={i}
              role="menuitem"
              disabled={item.disabled}
              onMouseEnter={() => setActive(i)}
              onClick={() => {
                hide();
                item.onSelect();
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left disabled:opacity-40 ${
                active === i ? 'bg-[var(--vela-sidebar-active-bg)]' : ''
              } ${item.danger ? 'text-[var(--vela-danger)]' : ''}`}
            >
              <span className="flex w-4 justify-center">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.shortcut && <span className="text-[var(--vela-fg-muted)]">{item.shortcut}</span>}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
