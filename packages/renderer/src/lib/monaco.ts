import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { themeManager } from '../theme';

// Workers empaquetados por Vite: nada se carga de fuera (la CSP lo impediría).
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'json':
        return new JsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker();
      case 'typescript':
      case 'javascript':
        return new TsWorker();
      default:
        return new EditorWorker();
    }
  },
};

export { monaco };

export const VELA_THEME = 'vela';

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Tema de Monaco a partir de las variables `--vela-*` activas. */
export function applyMonacoTheme(): void {
  const css = getComputedStyle(document.documentElement);
  const colors: Record<string, string> = {};
  const map: Array<[string, string]> = [
    ['editor.background', '--vela-bg'],
    ['editor.foreground', '--vela-fg'],
    ['editorLineNumber.activeForeground', '--vela-fg'],
    ['editorLineNumber.foreground', '--vela-fg-muted'],
    ['editorCursor.foreground', '--vela-accent'],
    ['editor.lineHighlightBackground', '--vela-bg-row-hover'],
    ['editorWidget.background', '--vela-bg-elevated'],
    ['editorWidget.border', '--vela-border'],
    ['focusBorder', '--vela-accent'],
  ];
  for (const [key, variable] of map) {
    const value = css.getPropertyValue(variable).trim();
    if (HEX.test(value)) colors[key] = value;
  }
  const dark = themeManager.getCurrentTheme().type === 'dark';
  monaco.editor.defineTheme(VELA_THEME, { base: dark ? 'vs-dark' : 'vs', inherit: true, rules: [], colors });
  monaco.editor.setTheme(VELA_THEME);
}

/** Lenguaje de Monaco para un nombre de fichero; `plaintext` si no se reconoce. */
export function languageForFile(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot) : null;
  for (const language of monaco.languages.getLanguages()) {
    if (language.filenames?.some((f) => f.toLowerCase() === lower)) return language.id;
    if (ext && language.extensions?.some((e) => e.toLowerCase() === ext)) return language.id;
  }
  return 'plaintext';
}
