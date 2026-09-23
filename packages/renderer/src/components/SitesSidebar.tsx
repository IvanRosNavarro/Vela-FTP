import { useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import {
  Bookmark as BookmarkIcon,
  ChevronDown,
  ChevronRight,
  Copy,
  FileInput,
  FolderPlus,
  KeyRound,
  Lock,
  LockOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
  Pencil,
  Plug,
  Plus,
  Settings,
  Settings2,
  Trash2,
} from 'lucide-react';
import type { Bookmark, Project, Site } from '@vela-ftp/shared';
import { toast } from 'vela-kit/ui';
import { call, errorText } from '../lib/ipc';
import { openBookmark } from '../lib/openBookmark';
import { confirmDialog, promptDialog, useDialogStore } from '../stores/dialogStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { useSitesStore } from '../stores/sitesStore';
import { useContextMenu, type MenuItem } from './ContextMenu';
import { PROTOCOL_LABEL, SiteIcon } from './SiteIcon';

export const PROJECT_COLORS: Array<{ value: string; label: string }> = [
  { value: '#46b5a0', label: 'Verde azulado' },
  { value: '#7d8cff', label: 'Añil' },
  { value: '#e5a84b', label: 'Ámbar' },
  { value: '#e06c75', label: 'Coral' },
  { value: '#61afef', label: 'Azul' },
  { value: '#c678dd', label: 'Violeta' },
  { value: '#98c379', label: 'Verde' },
  { value: '#abb2bf', label: 'Gris' },
];

const SITE_MIME = 'application/x-vela-site';
const PROJECT_MIME = 'application/x-vela-project';

type DropHint = { kind: 'project'; id: string | null } | { kind: 'site'; id: string } | null;

async function run<T>(what: string, promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    toast(`${what}: ${errorText(err)}`, 'error');
    return null;
  }
}

export async function createProject(): Promise<void> {
  const name = await promptDialog({
    title: 'Nuevo proyecto',
    label: 'Nombre',
    initial: 'Nuevo proyecto',
    confirmLabel: 'Crear',
    validate: (v) => (v.trim() ? null : 'Escribe un nombre'),
  });
  if (!name) return;
  const color = PROJECT_COLORS[useSitesStore.getState().projects.length % PROJECT_COLORS.length]!.value;
  await run('No se pudo crear el proyecto', call(window.api.projects.create({ name: name.trim(), color })));
}

function TreeRow({
  depth,
  active,
  hint,
  children,
  className = '',
  ...rest
}: {
  depth: number;
  active?: boolean;
  hint?: boolean;
  children: ReactNode;
} & React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean }) {
  return (
    <div
      role="treeitem"
      tabIndex={0}
      style={{ paddingLeft: 8 + depth * 14 }}
      {...rest}
      className={`group flex cursor-default select-none items-center gap-1.5 rounded-md py-1 pr-1.5 text-xs outline-none hover:bg-[var(--vela-sidebar-hover-bg)] focus-visible:bg-[var(--vela-sidebar-hover-bg)] ${
        active ? 'bg-[var(--vela-sidebar-active-bg)]' : ''
      } ${hint ? 'ring-1 ring-[var(--vela-accent)]' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

/** Ancho de la franja de iconos. */
export const COLLAPSED_SIDEBAR_WIDTH = 44;

export interface SitesSidebarProps {
  width: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function SitesSidebar({ width, collapsed, onToggleCollapsed }: SitesSidebarProps) {
  const sites = useSitesStore((s) => s.sites);
  const projects = useSitesStore((s) => s.projects);
  const bookmarks = useSitesStore((s) => s.bookmarks);
  const vault = useSitesStore((s) => s.vault);
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
  const connecting = useSessionsStore((s) => s.connecting);
  const connect = useSessionsStore((s) => s.connect);
  const openDialog = useDialogStore((s) => s.open);
  const showMenu = useContextMenu((s) => s.show);
  const [hint, setHint] = useState<DropHint>(null);

  const activeSiteId = sessions.find((s) => s.sessionId === activeId)?.siteId;
  const groups: Array<{ project: Project | null; sites: Site[] }> = [
    ...projects.map((project) => ({ project, sites: sites.filter((s) => s.projectId === project.id) })),
    { project: null, sites: sites.filter((s) => !s.projectId || !projects.some((p) => p.id === s.projectId)) },
  ];

  // ── Acciones ────────────────────────────────────────────────────────────
  const removeSite = async (site: Site) => {
    const ok = await confirmDialog({
      title: 'Borrar sitio',
      message: `¿Borrar «${site.name}», su contraseña guardada y sus marcadores?`,
      confirmLabel: 'Borrar',
      danger: true,
    });
    if (ok) await run('No se pudo borrar', call(window.api.sites.delete(site.id)));
  };

  const renameProject = async (project: Project) => {
    const name = await promptDialog({
      title: 'Renombrar proyecto',
      label: 'Nombre',
      initial: project.name,
      confirmLabel: 'Renombrar',
      validate: (v) => (v.trim() ? null : 'Escribe un nombre'),
    });
    if (name && name.trim() !== project.name) await run('No se pudo renombrar', call(window.api.projects.update(project.id, { name: name.trim() })));
  };

  const removeProject = async (project: Project, count: number) => {
    const ok = await confirmDialog({
      title: 'Borrar proyecto',
      message: count
        ? `¿Borrar el proyecto «${project.name}»? Sus ${count} sitios no se borran: pasan a «Sin proyecto».`
        : `¿Borrar el proyecto «${project.name}»?`,
      confirmLabel: 'Borrar',
      danger: true,
    });
    if (ok) await run('No se pudo borrar el proyecto', call(window.api.projects.delete(project.id)));
  };

  const renameBookmark = async (bookmark: Bookmark) => {
    const name = await promptDialog({
      title: 'Renombrar marcador',
      label: bookmark.remotePath,
      initial: bookmark.name,
      confirmLabel: 'Renombrar',
      validate: (v) => (v.trim() ? null : 'Escribe un nombre'),
    });
    if (name) await run('No se pudo renombrar', call(window.api.bookmarks.update(bookmark.id, { name: name.trim() })));
  };

  const lockToggle = async () => {
    if (!vault) return;
    if (vault.mode !== 'master-password') {
      openDialog({ kind: 'settings', section: 'security' });
      return;
    }
    if (vault.locked) {
      openDialog({ kind: 'unlock', resolve: () => undefined });
      return;
    }
    await run('No se pudo bloquear', call(window.api.vault.lock()));
    toast('Contraseñas bloqueadas', 'info');
  };

  // ── Arrastrar y soltar ─────────────────────────────────────────────────
  const dragKind = (e: DragEvent) => (e.dataTransfer.types.includes(SITE_MIME) ? 'site' : e.dataTransfer.types.includes(PROJECT_MIME) ? 'project' : null);

  const onDragOverProject = (e: DragEvent, projectId: string | null) => {
    const kind = dragKind(e);
    if (!kind || (kind === 'project' && projectId === null)) return;
    e.preventDefault();
    setHint({ kind: 'project', id: projectId });
  };

  const onDropProject = async (e: DragEvent, projectId: string | null) => {
    e.preventDefault();
    setHint(null);
    const siteId = e.dataTransfer.getData(SITE_MIME);
    if (siteId) {
      await run('No se pudo mover el sitio', call(window.api.sites.relocate(siteId, projectId, null, null)));
      return;
    }
    const movedProject = e.dataTransfer.getData(PROJECT_MIME);
    if (movedProject && projectId && movedProject !== projectId) {
      const index = projects.findIndex((p) => p.id === projectId);
      const before = projects.slice(0, index).filter((p) => p.id !== movedProject).at(-1)?.id ?? null;
      await run('No se pudo mover el proyecto', call(window.api.projects.move(movedProject, before, projectId)));
    }
  };

  const onDragOverSite = (e: DragEvent, site: Site) => {
    if (dragKind(e) !== 'site') return;
    e.preventDefault();
    e.stopPropagation();
    setHint({ kind: 'site', id: site.id });
  };

  const onDropSite = async (e: DragEvent, target: Site, group: Site[]) => {
    e.preventDefault();
    e.stopPropagation();
    setHint(null);
    const siteId = e.dataTransfer.getData(SITE_MIME);
    if (!siteId || siteId === target.id) return;
    const index = group.findIndex((s) => s.id === target.id);
    const before = group.slice(0, index).filter((s) => s.id !== siteId).at(-1)?.id ?? null;
    await run('No se pudo mover el sitio', call(window.api.sites.relocate(siteId, target.projectId ?? null, before, target.id)));
  };

  // ── Filas ───────────────────────────────────────────────────────────────
  const siteMenu = (site: Site): MenuItem[] => [
    { label: 'Conectar', icon: <Plug size={13} />, disabled: connecting === site.id, onSelect: () => void connect(site.id) },
    { kind: 'separator' },
    { label: 'Editar…', icon: <Pencil size={13} />, onSelect: () => openDialog({ kind: 'siteEditor', site }) },
    { label: 'Duplicar', icon: <Copy size={13} />, onSelect: () => void run('No se pudo duplicar', call(window.api.sites.duplicate(site.id))) },
    ...(site.projectId
      ? [{ label: 'Sacar del proyecto', icon: <FileInput size={13} />, onSelect: () => void run('No se pudo mover', call(window.api.sites.relocate(site.id, null, null, null))) }]
      : []),
    { kind: 'separator' },
    { label: 'Borrar', icon: <Trash2 size={13} />, danger: true, onSelect: () => void removeSite(site) },
  ];

  const renderSite = (site: Site, group: Site[], depth: number) => {
    const connected = sessions.some((s) => s.siteId === site.id);
    const siteBookmarks = bookmarks.filter((b) => b.siteId === site.id);
    return (
      <div key={site.id} role="group">
        <TreeRow
          depth={depth}
          active={activeSiteId === site.id}
          hint={hint?.kind === 'site' && hint.id === site.id}
          className="vela-site"
          draggable
          title={`${site.protocol}://${site.username ? `${site.username}@` : ''}${site.host}:${site.port}\nDoble clic para conectar`}
          onDragStart={(e) => {
            e.dataTransfer.setData(SITE_MIME, site.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => onDragOverSite(e, site)}
          onDragLeave={() => setHint(null)}
          onDrop={(e) => void onDropSite(e, site, group)}
          onDoubleClick={() => void connect(site.id)}
          onKeyDown={(e) => e.key === 'Enter' && void connect(site.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            showMenu(e.clientX, e.clientY, siteMenu(site));
          }}
        >
          <SiteIcon protocol={site.protocol} connected={connected} connecting={connecting === site.id} />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{site.name}</span>
            <span className="block truncate text-[10px] text-[var(--vela-fg-muted)]">{site.host}</span>
          </span>
          <span className="rounded bg-black/10 px-1 text-[9px] text-[var(--vela-fg-muted)]">{PROTOCOL_LABEL[site.protocol]}</span>
          <button
            className="shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
            title="Editar"
            onClick={(e) => {
              e.stopPropagation();
              openDialog({ kind: 'siteEditor', site });
            }}
          >
            <Settings2 size={13} />
          </button>
        </TreeRow>
        {siteBookmarks.map((bookmark) => (
          <TreeRow
            key={bookmark.id}
            depth={depth + 1}
            title={`${bookmark.remotePath}${bookmark.localPath ? `\n↔ ${bookmark.localPath}` : ''}`}
            onClick={() => void openBookmark(bookmark)}
            onKeyDown={(e) => e.key === 'Enter' && void openBookmark(bookmark)}
            onContextMenu={(e) => {
              e.preventDefault();
              showMenu(e.clientX, e.clientY, [
                { label: 'Abrir', icon: <BookmarkIcon size={13} />, onSelect: () => void openBookmark(bookmark) },
                { label: 'Renombrar…', icon: <Pencil size={13} />, onSelect: () => void renameBookmark(bookmark) },
                { kind: 'separator' },
                {
                  label: 'Borrar marcador',
                  icon: <Trash2 size={13} />,
                  danger: true,
                  onSelect: () => void run('No se pudo borrar', call(window.api.bookmarks.delete(bookmark.id))),
                },
              ]);
            }}
          >
            <BookmarkIcon size={12} className="shrink-0 text-[var(--vela-fg-muted)]" />
            <span className="truncate text-[var(--vela-fg-muted)]">{bookmark.name}</span>
          </TreeRow>
        ))}
      </div>
    );
  };

  const hasProjects = projects.length > 0;

  if (collapsed) {
    return (
      <aside
        id="vela-sidebar"
        style={{ width: COLLAPSED_SIDEBAR_WIDTH, '--vf-glass': 'var(--vela-sidebar-bg)' } as CSSProperties}
        className="vf-glass flex shrink-0 flex-col items-center text-[var(--vela-sidebar-fg)]"
      >
        <button className="vf-icon-btn mt-2" title="Mostrar los sitios" aria-label="Mostrar los sitios" onClick={onToggleCollapsed}>
          <PanelLeftOpen size={16} />
        </button>

        <div role="tree" aria-label="Sitios" className="vela-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-2">
          {groups.map(({ project, sites: groupSites }) => {
            if (groupSites.length === 0) return null;
            return (
              <div
                key={project?.id ?? '__none'}
                role="group"
                className="flex flex-col items-center gap-0.5 border-l-2 pl-0.5"
                style={{ borderColor: project?.color ?? 'transparent' }}
                title={project?.name ?? 'Sin proyecto'}
              >
                {groupSites.map((site) => (
                  <button
                    key={site.id}
                    role="treeitem"
                    aria-label={site.name}
                    aria-current={activeSiteId === site.id}
                    className={`flex h-8 w-8 items-center justify-center rounded-md hover:bg-[var(--vela-sidebar-hover-bg)] ${
                      activeSiteId === site.id ? 'bg-[var(--vela-sidebar-active-bg)]' : ''
                    }`}
                    title={`${site.name}\n${site.host}:${site.port} · ${PROTOCOL_LABEL[site.protocol]}${project ? `\nProyecto: ${project.name}` : ''}`}
                    onClick={() => void connect(site.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      showMenu(e.clientX, e.clientY, siteMenu(site));
                    }}
                  >
                    <SiteIcon protocol={site.protocol} connected={sessions.some((s) => s.siteId === site.id)} connecting={connecting === site.id} size={16} />
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        <div className="flex flex-col items-center gap-1 border-t border-[var(--vela-border)] py-2">
          <button className="vf-icon-btn" title="Nuevo sitio (Ctrl+N)" onClick={() => openDialog({ kind: 'siteEditor', site: null })}>
            <Plus size={15} />
          </button>
          <button
            className="vf-icon-btn"
            title={vault?.mode === 'master-password' ? (vault.locked ? 'Contraseñas bloqueadas' : 'Bloquear contraseñas') : 'Contraseñas guardadas'}
            onClick={() => void lockToggle()}
          >
            {vault?.mode === 'master-password' ? vault.locked ? <Lock size={15} /> : <LockOpen size={15} /> : <KeyRound size={15} />}
          </button>
          <button className="vf-icon-btn" title="Ajustes (Ctrl+,)" onClick={() => openDialog({ kind: 'settings' })}>
            <Settings size={15} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      id="vela-sidebar"
      style={{ width, '--vf-glass': 'var(--vela-sidebar-bg)' } as CSSProperties}
      className="vf-glass flex shrink-0 flex-col text-[var(--vela-sidebar-fg)]"
    >
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <span className="vf-panel-title">Sitios</span>
        <span className="flex">
          <button className="vf-icon-btn" title="Reducir a iconos" aria-label="Reducir a iconos" onClick={onToggleCollapsed}>
            <PanelLeftClose size={15} />
          </button>
          <button className="vf-icon-btn" title="Nuevo proyecto" onClick={() => void createProject()}>
            <FolderPlus size={15} />
          </button>
          <button className="vf-icon-btn" title="Nuevo sitio (Ctrl+N)" onClick={() => openDialog({ kind: 'siteEditor', site: null })}>
            <Plus size={15} />
          </button>
        </span>
      </div>

      <div role="tree" aria-label="Proyectos y sitios" className="vela-scroll min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {sites.length === 0 && !hasProjects && (
          <div className="flex flex-col items-center gap-3 px-2 py-6 text-center text-xs text-[var(--vela-fg-muted)]">
            Aún no hay sitios.
            <button className="vf-btn-primary" onClick={() => openDialog({ kind: 'siteEditor', site: null })}>
              <Plus size={13} /> Añadir sitio
            </button>
            <button className="vf-btn" onClick={() => openDialog({ kind: 'importFileZilla' })}>
              <FileInput size={13} /> Importar de FileZilla
            </button>
          </div>
        )}
        {groups.map(({ project, sites: groupSites }) => {
          if (!project) {
            if (groupSites.length === 0 && !hasProjects) return null;
            return (
              <div key="__none" role="group" className="mt-1">
                {hasProjects && (
                  <TreeRow
                    depth={0}
                    hint={hint?.kind === 'project' && hint.id === null}
                    onDragOver={(e) => onDragOverProject(e, null)}
                    onDragLeave={() => setHint(null)}
                    onDrop={(e) => void onDropProject(e, null)}
                  >
                    <span className="vf-panel-title flex-1">Sin proyecto</span>
                  </TreeRow>
                )}
                {groupSites.map((site) => renderSite(site, groupSites, hasProjects ? 1 : 0))}
              </div>
            );
          }
          const menu: MenuItem[] = [
            { label: 'Nuevo sitio aquí', icon: <Plus size={13} />, onSelect: () => openDialog({ kind: 'siteEditor', site: null, projectId: project.id }) },
            { label: 'Renombrar…', icon: <Pencil size={13} />, onSelect: () => void renameProject(project) },
            ...PROJECT_COLORS.map((c) => ({
              label: `Color: ${c.label}`,
              icon: <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c.value }} />,
              onSelect: () => void run('No se pudo cambiar el color', call(window.api.projects.update(project.id, { color: c.value }))),
            })),
            { kind: 'separator' },
            { label: 'Borrar proyecto', icon: <Trash2 size={13} />, danger: true, onSelect: () => void removeProject(project, groupSites.length) },
          ];
          return (
            <div key={project.id} role="group" className="mt-1">
              <TreeRow
                depth={0}
                aria-expanded={!project.collapsed}
                hint={hint?.kind === 'project' && hint.id === project.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(PROJECT_MIME, project.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => onDragOverProject(e, project.id)}
                onDragLeave={() => setHint(null)}
                onDrop={(e) => void onDropProject(e, project.id)}
                onClick={() => void call(window.api.projects.update(project.id, { collapsed: !project.collapsed }))}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft' && !project.collapsed) void call(window.api.projects.update(project.id, { collapsed: true }));
                  if (e.key === 'ArrowRight' && project.collapsed) void call(window.api.projects.update(project.id, { collapsed: false }));
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  showMenu(e.clientX, e.clientY, menu);
                }}
              >
                {project.collapsed ? <ChevronRight size={13} className="shrink-0" /> : <ChevronDown size={13} className="shrink-0" />}
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: project.color ?? 'var(--vela-fg-muted)' }} />
                <span className="flex-1 truncate font-medium">{project.name}</span>
                <span className="text-[10px] text-[var(--vela-fg-muted)]">{groupSites.length}</span>
                <button
                  className="shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
                  title="Opciones"
                  onClick={(e) => {
                    e.stopPropagation();
                    showMenu(e.clientX, e.clientY, menu);
                  }}
                >
                  <Palette size={12} />
                </button>
              </TreeRow>
              {!project.collapsed && groupSites.map((site) => renderSite(site, groupSites, 1))}
              {!project.collapsed && groupSites.length === 0 && (
                <div className="py-1 pl-8 text-[11px] text-[var(--vela-fg-muted)]">Arrastra sitios aquí</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-1 border-t border-[var(--vela-border)] p-2">
        <button className="vf-btn flex-1 justify-start" onClick={() => void lockToggle()} title="Contraseñas guardadas">
          {vault?.mode === 'master-password' ? (
            vault.locked ? (
              <>
                <Lock size={13} /> Bloqueadas
              </>
            ) : (
              <>
                <LockOpen size={13} /> Bloquear
              </>
            )
          ) : (
            <>
              <KeyRound size={13} /> Contraseñas
            </>
          )}
        </button>
        <button className="vf-icon-btn" title="Importar de FileZilla" onClick={() => openDialog({ kind: 'importFileZilla' })}>
          <FileInput size={15} />
        </button>
        <button className="vf-icon-btn" title="Ajustes (Ctrl+,)" onClick={() => openDialog({ kind: 'settings' })}>
          <Settings size={15} />
        </button>
      </div>
    </aside>
  );
}
