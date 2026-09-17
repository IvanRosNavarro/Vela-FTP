import { useEffect, useMemo } from 'react';
import { COMMAND_CATEGORY_LABELS } from '@vela-ftp/shared';
import { CommandPalette, toast, type PaletteItem } from 'vela-kit/ui';
import { call, errorText } from '../../lib/ipc';
import { openBookmark } from '../../lib/openBookmark';
import { useSessionsStore } from '../../stores/sessionsStore';
import { useSitesStore } from '../../stores/sitesStore';

type Target = { kind: 'command'; id: string } | { kind: 'site'; id: string } | { kind: 'bookmark'; id: string } | { kind: 'session'; id: string };

/**
 * Paleta de Vela FTP: los comandos del registro de main más entradas
 * dinámicas (conectar a un sitio, abrir un marcador, cambiar de sesión).
 */
export function PaletteHost({ initialQuery, onClose }: { initialQuery?: string; onClose: () => void }) {
  const commands = useSitesStore((s) => s.commands);
  const sites = useSitesStore((s) => s.sites);
  const projects = useSitesStore((s) => s.projects);
  const bookmarks = useSitesStore((s) => s.bookmarks);
  const sessions = useSessionsStore((s) => s.sessions);

  useEffect(() => {
    void useSitesStore.getState().loadCommands();
  }, []);

  const { items, targets } = useMemo(() => {
    const targets = new Map<string, Target>();
    const items: PaletteItem[] = [];
    const add = (item: PaletteItem, target: Target) => {
      items.push(item);
      targets.set(item.id, target);
    };
    for (const s of sessions) {
      add({ id: `session:${s.sessionId}`, title: `Ir a la sesión ${s.siteName}`, subtitle: s.host, group: 'Sesiones abiertas', keywords: ['pestaña'] }, { kind: 'session', id: s.sessionId });
    }
    for (const site of sites) {
      const project = projects.find((p) => p.id === site.projectId);
      add(
        {
          id: `site:${site.id}`,
          title: `Conectar a ${site.name}`,
          subtitle: project ? `${project.name} · ${site.host}` : site.host,
          group: 'Sitios',
          keywords: [site.host, site.username, project?.name ?? ''],
        },
        { kind: 'site', id: site.id },
      );
    }
    for (const bm of bookmarks) {
      const site = sites.find((s) => s.id === bm.siteId);
      add(
        { id: `bookmark:${bm.id}`, title: `Abrir marcador ${bm.name}`, subtitle: `${site?.name ?? ''} ${bm.remotePath}`, group: 'Marcadores', keywords: [bm.remotePath] },
        { kind: 'bookmark', id: bm.id },
      );
    }
    for (const c of commands) {
      if (c.id === 'app.commandPalette') continue;
      add({ id: `command:${c.id}`, title: c.title, group: COMMAND_CATEGORY_LABELS[c.category], shortcut: c.shortcut }, { kind: 'command', id: c.id });
    }
    return { items, targets };
  }, [commands, sites, projects, bookmarks, sessions]);

  const onSelect = (item: PaletteItem) => {
    const target = targets.get(item.id);
    if (!target) return;
    switch (target.kind) {
      case 'command':
        void call(window.api.commands.execute(target.id)).catch((err) => toast(errorText(err), 'error'));
        break;
      case 'site':
        void useSessionsStore.getState().connect(target.id);
        break;
      case 'session':
        useSessionsStore.getState().activate(target.id);
        break;
      case 'bookmark': {
        const bm = useSitesStore.getState().bookmarks.find((b) => b.id === target.id);
        if (bm) void openBookmark(bm);
        break;
      }
    }
  };

  return (
    <CommandPalette
      items={items}
      onSelect={onSelect}
      onClose={onClose}
      platform={window.api.platform}
      placeholder="Busca un comando, un sitio o un marcador…"
      initialQuery={initialQuery ?? ''}
    />
  );
}
