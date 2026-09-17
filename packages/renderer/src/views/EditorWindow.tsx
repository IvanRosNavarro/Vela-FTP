import { useCallback, useEffect, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import { IPC_EVENTS, type EditorDocument } from '@vela-ftp/shared';
import { NO_DRAG_STYLE, TitleBar, formatShortcut, toast } from 'vela-kit/ui';
import { CodeEditor, DiffView } from '../components/code/CodeEditor';
import { Modal } from '../components/dialogs/Modal';
import { AppError, call, errorText } from '../lib/ipc';

const PLATFORM = window.api.platform;

type Prompt = 'close' | 'conflict' | null;

function useMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => window.api.on(IPC_EVENTS.WINDOW_MAXIMIZED_CHANGED, ({ maximized: next }) => setMaximized(next)), []);
  return maximized;
}

/** Ventana de edición o de diff de un fichero remoto. */
export function EditorWindow({ id }: { id: string }) {
  const [doc, setDoc] = useState<EditorDocument | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const content = useRef('');
  const closeAfterSave = useRef(false);
  const maximized = useMaximized();

  useEffect(() => {
    void call(window.api.editor.load(id))
      .then((loaded) => {
        setDoc(loaded);
        if (loaded.mode === 'edit') content.current = loaded.content;
        document.title = loaded.mode === 'edit' ? `${loaded.name} — ${loaded.siteName}` : `${loaded.name}: ${loaded.siteName} ↔ local`;
      })
      .catch((err) => setLoadError(errorText(err)));
  }, [id]);

  const markDirty = useCallback(
    (next: boolean) => {
      setDirty((current) => {
        if (current !== next) void window.api.editor.setDirty(id, next);
        return next;
      });
    },
    [id],
  );

  const save = useCallback(
    async (force = false) => {
      if (saving) return;
      setSaving(true);
      try {
        const result = await call(window.api.editor.save(id, content.current, force));
        markDirty(false);
        setSavedAt(result.savedAt);
        setPrompt(null);
        if (closeAfterSave.current) void window.api.editor.close(id);
      } catch (err) {
        if (err instanceof AppError && err.code === 'REMOTE_CHANGED') {
          setPrompt('conflict');
        } else {
          closeAfterSave.current = false;
          toast(`No se pudo guardar: ${errorText(err)}`, 'error');
        }
      } finally {
        setSaving(false);
      }
    },
    [id, saving, markDirty],
  );

  // main pregunta al cerrar con cambios sin guardar.
  useEffect(() => window.api.on(IPC_EVENTS.EDITOR_CLOSE_REQUESTED, () => setPrompt('close')), []);

  const title = !doc ? 'Vela FTP' : doc.mode === 'diff' ? `${doc.name}: ${doc.siteName} ↔ local` : `${dirty ? '● ' : ''}${doc.name} — ${doc.siteName}`;

  return (
    <div id="vela-shell" className="flex h-full flex-col">
      <TitleBar
        platform={PLATFORM}
        maximized={maximized}
        controls={{
          onMinimize: () => void window.api.window.minimize(),
          onToggleMaximize: () => void window.api.window.toggleMaximize(),
          onClose: () => void window.api.window.close(),
        }}
      >
        <span className="truncate px-3 text-xs font-medium">{title}</span>
      </TitleBar>

      {doc && (
        <div className="flex items-center gap-3 border-b border-[var(--vela-border)] px-3 py-1 text-[11px] text-[var(--vela-fg-muted)]">
          {doc.mode === 'edit' ? (
            <>
              <span className="min-w-0 flex-1 truncate font-mono" title={doc.remotePath}>
                {doc.remotePath}
              </span>
              <span>{saving ? 'Guardando…' : dirty ? 'Sin guardar' : savedAt ? `Guardado ${new Date(savedAt).toLocaleTimeString()}` : ''}</span>
              <button style={NO_DRAG_STYLE} className="vf-btn-primary py-1" disabled={!dirty || saving} onClick={() => void save()}>
                <Save size={12} /> Guardar <span className="opacity-70">{formatShortcut('Ctrl+S', PLATFORM)}</span>
              </button>
            </>
          ) : (
            <div className="grid flex-1 grid-cols-2 gap-4">
              <span className="truncate" title={doc.remotePath}>
                Servidor · <span className="font-mono">{doc.remotePath}</span>
              </span>
              <span className="truncate" title={doc.localPath}>
                Local · <span className="font-mono">{doc.localPath}</span>
              </span>
            </div>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {loadError && <div className="flex h-full items-center justify-center p-6 text-xs text-[var(--vela-danger)]">{loadError}</div>}
        {doc?.mode === 'edit' && (
          <CodeEditor
            fileName={doc.name}
            value={doc.content}
            onReady={(editor) => editor.focus()}
            onChange={(value) => {
              content.current = value;
              markDirty(true);
            }}
            onSave={() => void save()}
          />
        )}
        {doc?.mode === 'diff' && <DiffView fileName={doc.name} original={doc.original} modified={doc.modified} />}
      </div>

      {prompt === 'close' && (
        <Modal
          title="Cambios sin guardar"
          onClose={() => setPrompt(null)}
          footer={
            <>
              <button className="vf-btn" onClick={() => setPrompt(null)}>
                Cancelar
              </button>
              <button className="vf-btn-danger" onClick={() => void window.api.editor.close(id)}>
                Descartar
              </button>
              <button
                className="vf-btn-primary"
                disabled={saving}
                onClick={() => {
                  closeAfterSave.current = true;
                  void save();
                }}
              >
                Guardar y cerrar
              </button>
            </>
          }
        >
          ¿Guardar los cambios de «{doc?.name}» en el servidor antes de cerrar?
        </Modal>
      )}

      {prompt === 'conflict' && (
        <Modal
          title="El fichero cambió en el servidor"
          onClose={() => {
            closeAfterSave.current = false;
            setPrompt(null);
          }}
          footer={
            <>
              <button
                className="vf-btn"
                onClick={() => {
                  closeAfterSave.current = false;
                  setPrompt(null);
                }}
              >
                Cancelar
              </button>
              <button className="vf-btn-danger" disabled={saving} onClick={() => void save(true)}>
                Sobrescribir
              </button>
            </>
          }
        >
          Alguien ha modificado «{doc?.name}» desde que lo abriste. Si guardas, sus cambios se perderán.
        </Modal>
      )}
    </div>
  );
}

export default EditorWindow;
