import { useEffect, useRef } from 'react';
import { applyMonacoTheme, languageForFile, monaco } from '../../lib/monaco';

const BASE_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  minimap: { enabled: false },
  fontSize: 13,
  scrollBeyondLastLine: false,
  renderWhitespace: 'selection',
  unicodeHighlight: { ambiguousCharacters: true, invisibleCharacters: true },
};

export interface CodeEditorProps {
  fileName: string;
  value: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onSave?: () => void;
  /** El editor ya está montado: para enfocarlo o leer su valor. */
  onReady?: (editor: monaco.editor.IStandaloneCodeEditor) => void;
}

/** Monaco con el tema de Vela. Se carga bajo demanda: pesa varios MB. */
export function CodeEditor({ fileName, value, readOnly = false, onChange, onSave, onReady }: CodeEditorProps) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onChange, onSave });
  callbacks.current = { onChange, onSave };

  useEffect(() => {
    if (!container.current) return;
    applyMonacoTheme();
    const model = monaco.editor.createModel(value, languageForFile(fileName));
    const editor = monaco.editor.create(container.current, { ...BASE_OPTIONS, model, readOnly });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => callbacks.current.onSave?.());
    const sub = model.onDidChangeContent(() => callbacks.current.onChange?.(model.getValue()));
    onReady?.(editor);
    return () => {
      sub.dispose();
      editor.dispose();
      model.dispose();
    };
    // El documento se monta una vez: los cambios de `value` los hace el propio editor.
  }, [fileName, readOnly]);

  return <div ref={container} className="h-full w-full" />;
}

export interface DiffViewProps {
  fileName: string;
  original: string;
  modified: string;
}

export function DiffView({ fileName, original, modified }: DiffViewProps) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    applyMonacoTheme();
    const language = languageForFile(fileName);
    const originalModel = monaco.editor.createModel(original, language);
    const modifiedModel = monaco.editor.createModel(modified, language);
    const diff = monaco.editor.createDiffEditor(container.current, {
      ...BASE_OPTIONS,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
    });
    diff.setModel({ original: originalModel, modified: modifiedModel });
    return () => {
      diff.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
    };
  }, [fileName, original, modified]);

  return <div ref={container} className="h-full w-full" />;
}

export default CodeEditor;
