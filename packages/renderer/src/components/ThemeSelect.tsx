import { useState } from 'react';
import { BUILTIN_THEMES } from 'vela-kit/theme';
import { toast } from 'vela-kit/ui';
import { themeManager } from '../theme';

// TODO(deuda): selector provisional hasta que existan ajustes y paleta de comandos (Fase 2).
export function ThemeSelect() {
  const [themeId, setThemeId] = useState(() => themeManager.getCurrentThemeId());

  const change = async (next: string) => {
    const previous = themeId;
    themeManager.setTheme(next);
    setThemeId(next);
    const res = await window.api.settings.set('ui:theme', next);
    if (!res.ok) {
      themeManager.setTheme(previous);
      setThemeId(previous);
      toast('No se pudo guardar el tema', 'error');
    }
  };

  return (
    <label className="flex flex-col gap-1 text-xs text-[var(--vela-fg-muted)]">
      Tema
      <select
        value={themeId}
        onChange={(e) => void change(e.target.value)}
        className="rounded border border-[var(--vela-border)] bg-[var(--vela-bg-elevated)] px-2 py-1 text-[var(--vela-fg)]"
      >
        <option value="system">Sistema</option>
        {BUILTIN_THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}
