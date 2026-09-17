import { app, BrowserWindow } from 'electron';
import { CommandRegistry, createCommandDefiner } from 'vela-kit/commands';

export interface CommandContext {
  windowId: number | null;
}

export type CommandCategory = 'view' | 'window';

export const defineCommand = createCommandDefiner<CommandContext, CommandCategory>();

function windowOf(ctx: CommandContext): BrowserWindow | null {
  return ctx.windowId === null ? null : BrowserWindow.fromId(ctx.windowId);
}

export function buildCommandRegistry(): CommandRegistry<CommandContext, CommandCategory> {
  const registry = new CommandRegistry<CommandContext, CommandCategory>();

  // Sin menú nativo no hay otra forma de abrir DevTools.
  if (!app.isPackaged) {
    registry.register(
      defineCommand({
        id: 'view.toggleDevTools',
        title: 'Herramientas de desarrollo',
        category: 'view',
        defaultShortcut: 'F12',
        run: (ctx) => windowOf(ctx)?.webContents.toggleDevTools(),
      }),
    );
  }

  registry.register(
    defineCommand({
      id: 'view.reload',
      title: 'Recargar interfaz',
      category: 'view',
      defaultShortcut: 'Ctrl+Shift+R',
      run: (ctx) => windowOf(ctx)?.webContents.reload(),
    }),
  );

  return registry;
}
