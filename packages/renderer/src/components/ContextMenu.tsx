import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { create } from 'zustand';

export type MenuItem =
  | { kind?: 'item'; label: string; icon?: ReactNode; shortcut?: string; danger?: boolean; disabled?: boolean; onSelect: () => void }
  | { kind: 'submenu'; label: string; icon?: ReactNode; disabled?: boolean; items: MenuItem[] }
  | { kind: 'separator' };

interface MenuState {
  /** `seq` cambia con cada menú: se vuelve a montar desde cero. */
  menu: { seq: number; x: number; y: number; items: MenuItem[] } | null;
  show(x: number, y: number, items: MenuItem[]): void;
  hide(): void;
}

let seq = 0;

export const useContextMenu = create<MenuState>((set) => ({
  menu: null,
  show: (x, y, items) => set({ menu: { seq: ++seq, x, y, items } }),
  hide: () => set({ menu: null }),
}));

/** Dónde abrir un panel: el menú raíz en un punto; un submenú junto a su fila. */
type Anchor = { kind: 'point'; x: number; y: number } | { kind: 'row'; rect: DOMRect };

interface PanelProps {
  items: MenuItem[];
  anchor: Anchor;
  /** Coge el foco al abrirse (con teclado); al pasar el ratón no. */
  autoFocus: boolean;
  /** Cierra el submenú y devuelve el foco al panel de arriba; null en el raíz. */
  onBack: (() => void) | null;
}

function MenuPanel({ items, anchor, autoFocus, onBack }: PanelProps) {
  const hide = useContextMenu((s) => s.hide);
  const ref = useRef<HTMLDivElement>(null);
  const rows = useRef<Array<HTMLButtonElement | null>>([]);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [active, setActive] = useState(-1);
  const [sub, setSub] = useState<{ index: number; focus: boolean } | null>(null);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    if (anchor.kind === 'point') {
      setPos({ left: Math.min(anchor.x, window.innerWidth - width - 4), top: Math.min(anchor.y, window.innerHeight - height - 4) });
    } else {
      // A la derecha de la fila; si no cabe, a la izquierda del menú.
      const fitsRight = anchor.rect.right + width - 2 <= window.innerWidth - 4;
      setPos({
        left: Math.max(4, fitsRight ? anchor.rect.right - 2 : anchor.rect.left - width + 2),
        top: Math.max(4, Math.min(anchor.rect.top - 4, window.innerHeight - height - 4)),
      });
    }
    // Solo al abrir: el panel no cambia de sitio mientras está abierto.
  }, []);

  // Con el panel ya visible: uno con `visibility: hidden` no puede coger el foco.
  const placed = pos !== null;
  useEffect(() => {
    if (!placed || !autoFocus) return;
    ref.current?.focus();
    if (onBack) setActive(items.findIndex((item) => item.kind !== 'separator' && !item.disabled));
  }, [placed]);

  const selectable = items.map((item, i) => (item.kind !== 'separator' && !item.disabled ? i : -1)).filter((i) => i >= 0);

  const activate = (i: number, viaKeyboard: boolean) => {
    const item = items[i];
    if (!item || item.kind === 'separator' || item.disabled) return;
    if (item.kind === 'submenu') {
      setSub({ index: i, focus: viaKeyboard });
      return;
    }
    hide();
    item.onSelect();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      if (onBack) onBack();
      else hide();
    } else if (e.key === 'ArrowLeft' && onBack) {
      onBack();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = selectable.indexOf(active);
      const next = e.key === 'ArrowDown' ? selectable[(idx + 1) % selectable.length] : selectable[(idx - 1 + selectable.length) % selectable.length];
      setActive(next ?? -1);
      setSub(null);
    } else if ((e.key === 'Enter' || (e.key === 'ArrowRight' && items[active]?.kind === 'submenu')) && active >= 0) {
      e.preventDefault();
      activate(active, true);
    }
  };

  const openSub = sub ? items[sub.index] : null;
  const subRect = sub ? rows.current[sub.index]?.getBoundingClientRect() : undefined;

  return (
    <>
      <div
        ref={ref}
        role="menu"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ left: pos?.left ?? (anchor.kind === 'point' ? anchor.x : 0), top: pos?.top ?? (anchor.kind === 'point' ? anchor.y : 0), visibility: pos ? 'visible' : 'hidden' }}
        className="fixed min-w-[200px] rounded-[var(--vela-radius-md)] border border-[var(--vela-border)] bg-[var(--vela-bg-elevated)] py-1 text-xs shadow-2xl outline-none"
      >
        {items.map((item, i) =>
          item.kind === 'separator' ? (
            <div key={i} className="my-1 border-t border-[var(--vela-border)]" />
          ) : (
            <button
              key={i}
              ref={(el) => {
                rows.current[i] = el;
              }}
              role="menuitem"
              aria-haspopup={item.kind === 'submenu' ? 'menu' : undefined}
              aria-expanded={item.kind === 'submenu' ? sub?.index === i : undefined}
              disabled={item.disabled}
              onMouseEnter={() => {
                setActive(i);
                setSub(item.kind === 'submenu' && !item.disabled ? { index: i, focus: false } : null);
              }}
              onClick={() => activate(i, false)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left disabled:opacity-40 ${
                active === i || sub?.index === i ? 'bg-[var(--vela-sidebar-active-bg)]' : ''
              } ${item.kind !== 'submenu' && item.danger ? 'text-[var(--vela-danger)]' : ''}`}
            >
              <span className="flex w-4 justify-center">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.kind === 'submenu' ? (
                <ChevronRight size={12} className="text-[var(--vela-fg-muted)]" />
              ) : (
                item.shortcut && <span className="text-[var(--vela-fg-muted)]">{item.shortcut}</span>
              )}
            </button>
          ),
        )}
      </div>
      {openSub?.kind === 'submenu' && subRect && (
        <MenuPanel
          key={`${sub!.index}:${sub!.focus}`}
          items={openSub.items}
          anchor={{ kind: 'row', rect: subRect }}
          autoFocus={sub!.focus}
          onBack={() => {
            setSub(null);
            ref.current?.focus();
          }}
        />
      )}
    </>
  );
}

/** Menú contextual DOM (sin WebContentsView no hace falta una ventana nativa). */
export function ContextMenuHost() {
  const menu = useContextMenu((s) => s.menu);
  const hide = useContextMenu((s) => s.hide);

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
  return (
    <div className="fixed inset-0 z-[300]" onMouseDown={hide} onContextMenu={(e) => (e.preventDefault(), hide())}>
      <MenuPanel key={menu.seq} items={menu.items} anchor={{ kind: 'point', x: menu.x, y: menu.y }} autoFocus onBack={null} />
    </div>
  );
}
