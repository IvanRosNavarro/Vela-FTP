import { useState } from 'react';
import { archiveFormatOf, archiveStem, type ArchiveConflict } from '@vela-ftp/shared';
import { toast } from 'vela-kit/ui';
import { compressEntries, defaultZipName, extractArchive, oppositePane, pathOpsFor, uniqueName } from '../../lib/archives';
import { call, errorText } from '../../lib/ipc';
import { isValidName } from '../../lib/paths';
import type { DialogSpec } from '../../stores/dialogStore';
import { isRemotePane, usePanesStore, type PaneKey } from '../../stores/panesStore';
import { Modal } from './Modal';

const IS_WINDOWS = window.api.platform === 'win32';

function Choice({ checked, onChange, label, hint }: { checked: boolean; onChange: () => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input type="radio" checked={checked} onChange={onChange} className="mt-0.5" />
      <span className="min-w-0">
        {label}
        {hint && <span className="block break-all font-mono text-[var(--vela-fg-muted)]">{hint}</span>}
      </span>
    </label>
  );
}

const sideLabel = (key: PaneKey) => (isRemotePane(key) ? 'en el servidor' : 'en este equipo');

type ExtractSpec = Extract<DialogSpec, { kind: 'extract' }>;
type ExtractDest = 'here' | 'folder' | 'other' | 'custom';

export function ExtractDialog({ spec, onClose }: { spec: ExtractSpec; onClose: () => void }) {
  const { paneKey, entry } = spec;
  const panes = usePanesStore((s) => s.panes);
  const here = panes[paneKey]?.path ?? '/';
  const otherKey = oppositePane(paneKey);
  const otherPath = otherKey ? panes[otherKey]?.path : undefined;
  const ops = pathOpsFor(paneKey);
  const remote = isRemotePane(paneKey);
  const single = archiveFormatOf(entry.name) === 'gz';

  const [dest, setDest] = useState<ExtractDest>(single ? 'here' : 'folder');
  const [folder, setFolder] = useState(archiveStem(entry.name));
  const [custom, setCustom] = useState(here);
  const [conflict, setConflict] = useState<ArchiveConflict>('skip');

  const target = ((): { pane: PaneKey; dir: string } | null => {
    switch (dest) {
      case 'here':
        return { pane: paneKey, dir: here };
      case 'folder':
        return isValidName(folder.trim(), !remote && IS_WINDOWS) ? { pane: paneKey, dir: ops.join(here, folder.trim()) } : null;
      case 'other':
        return otherKey && otherPath ? { pane: otherKey, dir: otherPath } : null;
      case 'custom': {
        const dir = custom.trim();
        return dir && (!remote || dir.startsWith('/')) ? { pane: paneKey, dir } : null;
      }
    }
  })();

  const browse = async () => {
    try {
      const picked = await call(window.api.dialog.open({ title: 'Extraer en', directory: true }));
      if (picked) {
        setCustom(picked);
        setDest('custom');
      }
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };

  const submit = () => {
    if (!target) return;
    onClose();
    void extractArchive({ sourcePane: paneKey, entry, targetPane: target.pane, targetDir: target.dir, conflict });
  };

  return (
    <Modal
      title={`Extraer «${entry.name}»`}
      onClose={onClose}
      width={500}
      footer={
        <>
          <button className="vf-btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="vf-btn-primary" disabled={!target} onClick={submit}>
            Extraer
          </button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <fieldset className="flex flex-col gap-1.5">
          <legend className="vf-panel-title mb-1.5">Dónde</legend>
          {!single && (
            <div className="flex flex-col gap-1">
              <Choice checked={dest === 'folder'} onChange={() => setDest('folder')} label="En una carpeta nueva dentro de esta" />
              <div className="pl-6">
                <input
                  className="vf-input w-full"
                  value={folder}
                  aria-label="Nombre de la carpeta"
                  onFocus={() => setDest('folder')}
                  onChange={(e) => setFolder(e.target.value)}
                />
              </div>
            </div>
          )}
          <Choice checked={dest === 'here'} onChange={() => setDest('here')} label="Aquí, en esta carpeta" hint={here} />
          {otherKey && otherPath && (
            <Choice checked={dest === 'other'} onChange={() => setDest('other')} label={`En la carpeta del otro panel (${sideLabel(otherKey)})`} hint={otherPath} />
          )}
          <div className="flex flex-col gap-1">
            <Choice checked={dest === 'custom'} onChange={() => setDest('custom')} label={`En otra carpeta ${sideLabel(paneKey)}`} />
            <div className="flex gap-1.5 pl-6">
              <input
                className="vf-input min-w-0 flex-1 font-mono"
                value={custom}
                aria-label="Carpeta de destino"
                onFocus={() => setDest('custom')}
                onChange={(e) => setCustom(e.target.value)}
              />
              {!remote && (
                <button type="button" className="vf-btn" onClick={() => void browse()}>
                  Examinar…
                </button>
              )}
            </div>
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="vf-panel-title mb-1.5">Si un fichero ya existe</legend>
          <Choice checked={conflict === 'skip'} onChange={() => setConflict('skip')} label="Dejar el que hay" />
          <Choice checked={conflict === 'overwrite'} onChange={() => setConflict('overwrite')} label="Sobrescribirlo" />
        </fieldset>
        {remote && (
          <p className="text-[var(--vela-fg-muted)]">
            Si el servidor lo permite, se extrae allí mismo por SSH; si no, Vela FTP lo baja, lo extrae y sube el resultado.
          </p>
        )}
      </form>
    </Modal>
  );
}

type CompressSpec = Extract<DialogSpec, { kind: 'compress' }>;

export function CompressDialog({ spec, onClose }: { spec: CompressSpec; onClose: () => void }) {
  const { paneKey, entries } = spec;
  const panes = usePanesStore((s) => s.panes);
  const pane = panes[paneKey];
  const here = pane?.path ?? '/';
  const otherKey = oppositePane(paneKey);
  const otherPane = otherKey ? panes[otherKey] : undefined;
  const ops = pathOpsFor(paneKey);

  const [name, setName] = useState(() => uniqueName(defaultZipName(entries, ops.basename(here)), new Set(pane?.entries.map((e) => e.name) ?? [])));
  const [dest, setDest] = useState<'here' | 'other'>('here');

  const targetKey = dest === 'other' && otherKey ? otherKey : paneKey;
  const targetDir = dest === 'other' && otherPane ? otherPane.path : here;
  const finalName = /\.zip$/i.test(name.trim()) ? name.trim() : `${name.trim()}.zip`;
  const taken = (dest === 'other' ? otherPane : pane)?.entries.some((e) => e.name === finalName) ?? false;
  const valid = isValidName(finalName, !isRemotePane(targetKey) && IS_WINDOWS) && name.trim() !== '';
  const error = !valid ? 'Nombre no válido' : taken ? 'Ya existe un fichero con ese nombre' : null;

  const submit = () => {
    if (error) return;
    onClose();
    void compressEntries({ sourcePane: paneKey, entries, targetPane: targetKey, zipPath: pathOpsFor(targetKey).join(targetDir, finalName) });
  };

  const what = entries.length === 1 ? `«${entries[0]!.name}»` : `${entries.length} elementos`;

  return (
    <Modal
      title={`Comprimir ${what}`}
      onClose={onClose}
      width={500}
      footer={
        <>
          <button className="vf-btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="vf-btn-primary" disabled={!!error} onClick={submit}>
            Comprimir
          </button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="vf-label">
          Nombre del ZIP
          <input className="vf-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          {error && <span className="text-[var(--vela-danger)]">{error}</span>}
        </label>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="vf-panel-title mb-1.5">Dónde</legend>
          <Choice checked={dest === 'here'} onChange={() => setDest('here')} label="En esta carpeta" hint={here} />
          {otherKey && otherPane && (
            <Choice checked={dest === 'other'} onChange={() => setDest('other')} label={`En la carpeta del otro panel (${sideLabel(otherKey)})`} hint={otherPane.path} />
          )}
        </fieldset>
        {isRemotePane(paneKey) && (
          <p className="text-[var(--vela-fg-muted)]">
            Si el servidor tiene <code>zip</code> y deja ejecutar órdenes, se comprime allí mismo; si no, Vela FTP lo baja, lo comprime y sube el ZIP.
          </p>
        )}
      </form>
    </Modal>
  );
}
