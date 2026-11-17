import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { registerPseudocode } from './pseudocodeLanguage';
import { registerJavaFormatter } from './javaFormatter';

// Everything is bundled locally: the editor works offline.
self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};

monaco.editor.defineTheme('lld-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'keyword.pseudo', foreground: 'C586C0', fontStyle: 'bold' },
    { token: 'type.pseudo', foreground: '4EC9B0' },
    { token: 'heading.pseudo', foreground: '569CD6', fontStyle: 'bold' },
    { token: 'function.pseudo', foreground: 'DCDCAA' },
  ],
  colors: { 'editor.background': '#1e1e1e' },
});
monaco.editor.defineTheme('lld-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'keyword.pseudo', foreground: 'AF00DB', fontStyle: 'bold' },
    { token: 'type.pseudo', foreground: '267F99' },
    { token: 'heading.pseudo', foreground: '0000FF', fontStyle: 'bold' },
    { token: 'function.pseudo', foreground: '795E26' },
  ],
  colors: {},
});

registerPseudocode(monaco);
registerJavaFormatter(monaco);

export { monaco };

export function languageForPath(path: string) {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const map: Record<string, string> = {
    java: 'java',
    md: 'markdown',
    pseudo: 'pseudocode',
    json: 'json',
    xml: 'xml',
    yml: 'yaml',
    yaml: 'yaml',
    properties: 'ini',
    js: 'javascript',
    ts: 'typescript',
    html: 'html',
    css: 'css',
    sql: 'sql',
    sh: 'shell',
    py: 'python',
    kt: 'kotlin',
    gradle: 'groovy',
  };
  return map[ext] ?? 'plaintext';
}
