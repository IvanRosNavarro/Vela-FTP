import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, KeyRound } from 'lucide-react';
import type { FileZillaPreview } from '@vela-ftp/shared';
import { toast } from 'vela-kit/ui';
import { AppError, call, errorText } from '../../lib/ipc';
import { Modal } from './Modal';

const PROTOCOL: Record<string, string> = { sftp: 'SFTP', ftps: 'FTPS', 'ftps-implicit': 'FTPS implícito', ftp: 'FTP' };

export function ImportFileZillaDialog({ onClose }: { onClose: () => void }) {
  const [preview, setPreview] = useState<FileZillaPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = async (path: string | null) => {
    setError(null);
    setPreview(null);
    try {
      const result = await call(window.api.import.previewFileZilla(path));
      setPreview(result);
      setSelected(new Set(result.sites.map((s) => s.key)));
    } catch (err) {
      setError(
        err instanceof AppError && err.code === 'NOT_FOUND'
          ? 'No se encontró sitemanager.xml en la ubicación habitual de FileZilla. Elige el fichero a mano.'
          : `No se pudo leer el fichero: ${errorText(err)}`,
      );
    }
  };

  useEffect(() => {
    void load(null);
  }, []);

  const pick = async () => {
    const path = await call(window.api.dialog.open({ title: 'sitemanager.xml de FileZilla', directory: false })).catch(() => null);
    if (path) void load(path);
  };

  const groups = useMemo(() => {
    const map = new Map<string, FileZillaPreview['sites']>();
    for (const s of preview?.sites ?? []) {
      const key = s.projectName ?? '';
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return [...map.entries()];
  }, [preview]);

  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const { created } = await call(window.api.import.applyFileZilla(preview.path, [...selected]));
      toast(`${created} sitios importados de FileZilla`, 'success');
      onClose();
    } catch (err) {
      toast(`No se pudo importar: ${errorText(err)}`, 'error');
      setBusy(false);
    }
  };

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Modal
      title="Importar sitios de FileZilla"
      onClose={onClose}
      width={620}
      footer={
        <>
          <button className="vf-btn mr-auto" onClick={() => void pick()}>
            Elegir otro fichero…
          </button>
          <button className="vf-btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="vf-btn-primary" disabled={!preview || selected.size === 0 || busy} onClick={() => void apply()}>
            Importar {selected.size > 0 ? `${selected.size} sitios` : ''}
          </button>
        </>
      }
    >
      {error && <p className="text-[var(--vela-warning)]">{error}</p>}
      {!error && !preview && <p className="text-[var(--vela-fg-muted)]">Leyendo…</p>}
      {preview && (
        <div className="flex flex-col gap-3">
          <p className="break-all text-[11px] text-[var(--vela-fg-muted)]">{preview.path}</p>
          {preview.sites.length === 0 && <p>El fichero no tiene sitios que se puedan importar.</p>}
          <p className="text-[11px] text-[var(--vela-fg-muted)]">
            Las carpetas de FileZilla se convierten en proyectos. Las contraseñas guardadas se cifran con el almacén de Vela FTP.
          </p>
          {groups.map(([project, sites]) => (
            <section key={project}>
              <h3 className="vf-panel-title mb-1">{project || 'Sin carpeta'}</h3>
              {sites.map((s) => (
                <label key={s.key} className="flex cursor-pointer items-start gap-2 border-b border-[var(--vela-border)] py-1.5 last:border-0">
                  <input type="checkbox" className="mt-0.5" checked={selected.has(s.key)} onChange={() => toggle(s.key)} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      {s.name}
                      <span className="rounded bg-black/10 px-1 text-[9px] text-[var(--vela-fg-muted)]">{PROTOCOL[s.protocol]}</span>
                      {s.hasPassword && <KeyRound size={11} className="text-[var(--vela-fg-muted)]" aria-label="Con contraseña" />}
                    </span>
                    <span className="block truncate text-[11px] text-[var(--vela-fg-muted)]">
                      {s.username ? `${s.username}@` : ''}
                      {s.host}:{s.port}
                      {s.remotePath ? ` · ${s.remotePath}` : ''}
                    </span>
                    {s.warnings.map((w) => (
                      <span key={w} className="mt-0.5 flex items-start gap-1 text-[11px] text-[var(--vela-warning)]">
                        <AlertTriangle size={11} className="mt-0.5 shrink-0" /> {w}
                      </span>
                    ))}
                  </span>
                </label>
              ))}
            </section>
          ))}
          {preview.skipped.length > 0 && (
            <section>
              <h3 className="vf-panel-title mb-1">No se importan</h3>
              {preview.skipped.map((s) => (
                <p key={s.name} className="text-[11px] text-[var(--vela-fg-muted)]">
                  {s.name}: {s.reason}
                </p>
              ))}
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
