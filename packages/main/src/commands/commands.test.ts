import { describe, expect, it, vi } from 'vitest';
import type { CommandCategory } from '@vela-ftp/shared';
import { CommandRegistry } from 'vela-kit/commands';
import { createTestDb } from '../test/createTestDb';
import { SettingsRepository } from '../storage/repositories/SettingsRepository';
import { PALETTE_SHORTCUT, ShortcutManager, defineCommand, type CommandContext } from './index';

function setup() {
  const registry = new CommandRegistry<CommandContext, CommandCategory>();
  const palette = vi.fn();
  const newSite = vi.fn();
  registry.register(defineCommand({ id: 'app.commandPalette', title: 'Paleta', category: 'app', defaultShortcut: PALETTE_SHORTCUT, run: palette }));
  registry.register(defineCommand({ id: 'site.new', title: 'Nuevo sitio', category: 'site', defaultShortcut: 'Ctrl+N', run: newSite }));
  registry.register(defineCommand({ id: 'view.refresh', title: 'Refrescar', category: 'view', defaultShortcut: 'Ctrl+R', run: () => undefined }));
  registry.register(defineCommand({ id: 'transfer.cancelAll', title: 'Cancelar todo', category: 'transfer', run: () => undefined }));
  const settings = new SettingsRepository(createTestDb());
  return { registry, settings, manager: new ShortcutManager(registry, settings), palette, newSite };
}

const key = (code: string, mods: { control?: boolean; shift?: boolean } = {}) => ({
  type: 'keyDown',
  control: !!mods.control,
  shift: !!mods.shift,
  alt: false,
  meta: false,
  code,
});

describe('ShortcutManager', () => {
  it('lista el atajo efectivo y marca la paleta como reservada', () => {
    const { manager } = setup();
    expect(manager.list().map((c) => [c.id, c.shortcut, c.reserved])).toEqual([
      ['app.commandPalette', PALETTE_SHORTCUT, true],
      ['site.new', 'Ctrl+N', false],
      ['view.refresh', 'Ctrl+R', false],
      ['transfer.cancelAll', null, false],
    ]);
  });

  it('valida formato, reserva, duplicados y comandos desconocidos', () => {
    const { manager } = setup();
    expect(manager.validate('transfer.cancelAll', 'Ctrl+Shift+X')).toEqual({ ok: true, combo: 'Ctrl+Shift+X' });
    expect(manager.validate('transfer.cancelAll', 'ctrl+n')).toMatchObject({ ok: false, reason: expect.stringContaining('Nuevo sitio') });
    expect(manager.validate('transfer.cancelAll', 'Control+Shift+KeyP')).toMatchObject({ ok: false, reason: expect.stringContaining('paleta') });
    expect(manager.validate('app.commandPalette', 'Ctrl+K')).toMatchObject({ ok: false });
    expect(manager.validate('nope', 'Ctrl+K')).toMatchObject({ ok: false, reason: 'Comando desconocido' });
    expect(manager.validate('site.new', 'Ctrl+Hyper+Q')).toMatchObject({ ok: false });
    expect(manager.validate('site.new', null)).toEqual({ ok: true, combo: null });
  });

  it('reconstruye la tabla con los atajos del usuario sin perder la paleta', async () => {
    const { manager, settings, newSite, palette } = setup();
    settings.set('shortcuts:custom', { 'site.new': 'Ctrl+Shift+N', 'view.refresh': null, 'app.commandPalette': 'Ctrl+K' });
    manager.rebuild();

    expect(manager.current.match(key('KeyN', { control: true }))).toBeNull();
    expect(manager.current.match(key('KeyR', { control: true }))).toBeNull();
    expect(manager.current.match(key('KeyK', { control: true }))).toBeNull();

    await manager.current.match(key('KeyN', { control: true, shift: true }))?.invoke(1);
    expect(newSite).toHaveBeenCalledOnce();
    await manager.current.match(key('KeyP', { control: true, shift: true }))?.invoke(1);
    expect(palette).toHaveBeenCalledOnce();
  });
});
