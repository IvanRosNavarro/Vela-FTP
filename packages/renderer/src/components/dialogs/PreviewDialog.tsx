import { Suspense, lazy, useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import type { FilePreview } from '@vela-ftp/shared';
import { toast } from 'vela-kit/ui';
import { formatSize } from '../../lib/format';
import { call, errorText } from '../../lib/ipc';
import type { PreviewSource } from '../../stores/dialogStore';
import { Modal } from './Modal';

const CodeEditor = lazy(() => import('../code/CodeEditor'));

export function PreviewDialog({ source, onClose }: { source: PreviewSource; onClose: () => void }) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = source.path.split(/[\\/]/).pop() ?? source.path;

  useEffect(() => {
    const request = source.kind === 'remote' ? window.api.files.previewRemote(source.sessionId, source.path) : window.api.files.previewLocal(source.path);
    void call(request)
      .then(setPreview)
      .catch((err) => setError(errorText(err)));
  }, [source]);

  const edit = () => {
    if (source.kind !== 'remote') return;
    onClose();
    void call(window.api.files.editRemote(source.sessionId, source.path)).catch((err) => toast(`No se pudo abrir: ${errorText(err)}`, 'error'));
  };

  return (
    <Modal
      title={preview ? `${name} · ${formatSize(preview.size)}` : name}
      onClose={onClose}
      width={880}
      footer={
        <>
          {source.kind === 'remote' && preview?.kind === 'text' && (
            <button className="vf-btn" onClick={edit}>
              <Pencil size={12} /> Editar
            </button>
          )}
          <button className="vf-btn-primary" onClick={onClose}>
            Cerrar
          </button>
        </>
      }
    >
      <div className="flex h-[60vh] flex-col">
        {error && <div className="m-auto text-[var(--vela-danger)]">{error}</div>}
        {!error && !preview && <div className="m-auto text-[var(--vela-fg-muted)]">Cargando…</div>}
        {preview?.kind === 'image' && (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded bg-[repeating-conic-gradient(#8881_0_25%,transparent_0_50%)] bg-[length:16px_16px]">
            <img src={preview.dataUrl} alt={name} className="max-h-full max-w-full object-contain" />
          </div>
        )}
        {preview?.kind === 'text' && (
          <>
            {preview.truncated && <p className="mb-2 text-[11px] text-[var(--vela-warning)]">Solo se muestra el primer MB del fichero.</p>}
            <div className="min-h-0 flex-1 overflow-hidden rounded border border-[var(--vela-border)]">
              <Suspense fallback={null}>
                <CodeEditor fileName={name} value={preview.content} readOnly />
              </Suspense>
            </div>
          </>
        )}
        {preview?.kind === 'binary' && <div className="m-auto text-[var(--vela-fg-muted)]">Fichero binario: no hay vista previa.</div>}
      </div>
    </Modal>
  );
}
