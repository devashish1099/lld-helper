import { monaco, languageForPath } from './monacoSetup';
import { api, type Diagnostic } from '../api/client';
import { useStore, errorMessage } from '../state/store';

/**
 * Owns one Monaco text model per open project file, shared by every editor
 * that shows it (code editor, pseudocode view, notes panels). Handles autosave.
 */
interface Entry {
  model: monaco.editor.ITextModel;
  problemId: string;
  savedVersion: number;
  timer?: number;
  saving?: Promise<void>;
  sub: monaco.IDisposable;
}

const AUTOSAVE_MS = 800;
const entries = new Map<string, Entry>();
const loading = new Map<string, Promise<monaco.editor.ITextModel>>();
const savedListeners = new Set<(path: string) => void>();
let diagnostics: Diagnostic[] = [];

const uriFor = (problemId: string, path: string) => monaco.Uri.from({ scheme: 'file', path: `/${problemId}/${path}` });

export const pathOfModel = (model: monaco.editor.ITextModel) => model.uri.path.split('/').slice(2).join('/');

export function onFileSaved(fn: (path: string) => void) {
  savedListeners.add(fn);
  return () => savedListeners.delete(fn);
}

function setDirty(path: string, dirty: boolean) {
  const cur = useStore.getState().dirty;
  if (!!cur[path] === dirty) return;
  const next = { ...cur };
  if (dirty) next[path] = true;
  else delete next[path];
  useStore.setState({ dirty: next });
}

export function getModel(path: string) {
  return entries.get(path)?.model;
}

export async function openModel(path: string): Promise<monaco.editor.ITextModel> {
  const problemId = useStore.getState().problem?.id;
  if (!problemId) throw new Error('No problem open');
  const existing = entries.get(path);
  if (existing) return existing.model;
  const key = `${problemId}:${path}`;
  if (!loading.has(key)) {
    loading.set(
      key,
      (async () => {
        const content = await api.readFile(problemId, path);
        const uri = uriFor(problemId, path);
        const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(content, languageForPath(path), uri);
        const entry: Entry = {
          model,
          problemId,
          savedVersion: model.getAlternativeVersionId(),
          sub: model.onDidChangeContent(() => {
            const dirty = model.getAlternativeVersionId() !== entry.savedVersion;
            setDirty(path, dirty);
            clearTimeout(entry.timer);
            if (dirty) entry.timer = window.setTimeout(() => void saveModel(path), AUTOSAVE_MS);
          }),
        };
        entries.set(path, entry);
        applyMarkers(path, model);
        return model;
      })().finally(() => loading.delete(key)),
    );
  }
  return loading.get(key)!;
}

export async function saveModel(path: string): Promise<void> {
  const e = entries.get(path);
  if (!e) return;
  clearTimeout(e.timer);
  await e.saving;
  const version = e.model.getAlternativeVersionId();
  if (version === e.savedVersion) return;
  const content = e.model.getValue();
  e.saving = api
    .writeFile(e.problemId, path, content)
    .then(() => {
      e.savedVersion = version;
      setDirty(path, e.model.getAlternativeVersionId() !== version);
      savedListeners.forEach((fn) => fn(path));
    })
    .catch((err) => {
      useStore.getState().toast(`Save failed for ${path}: ${errorMessage(err)}`, 'error');
    })
    .finally(() => (e.saving = undefined));
  await e.saving;
}

export async function saveAll() {
  await Promise.all([...entries.keys()].map(saveModel));
}

export async function closeModel(path: string) {
  await saveModel(path);
  const e = entries.get(path);
  if (!e) return;
  e.sub.dispose();
  e.model.dispose();
  entries.delete(path);
  setDirty(path, false);
}

/** Flush and drop every model (used when switching problems). */
export async function disposeAll() {
  await saveAll();
  for (const [path, e] of entries) {
    e.sub.dispose();
    e.model.dispose();
    entries.delete(path);
  }
  useStore.setState({ dirty: {} });
}

/** After a rename/move on disk: re-key open models under the new path(s). */
export async function remapModels(from: string, to: string) {
  for (const [path, e] of [...entries]) {
    if (path !== from && !path.startsWith(`${from}/`)) continue;
    const next = to + path.slice(from.length);
    const value = e.model.getValue();
    e.sub.dispose();
    e.model.dispose();
    entries.delete(path);
    setDirty(path, false);
    const m = await openModel(next);
    if (m.getValue() !== value) m.setValue(value);
  }
}

export function dropModels(prefix: string) {
  for (const [path, e] of [...entries]) {
    if (path !== prefix && !path.startsWith(`${prefix}/`)) continue;
    clearTimeout(e.timer);
    e.sub.dispose();
    e.model.dispose();
    entries.delete(path);
    setDirty(path, false);
  }
}

/** Replace a file's content (e.g. from AI-generated code) keeping undo history if it's open. */
export async function writeFileContent(path: string, content: string) {
  const problemId = useStore.getState().problem!.id;
  const e = entries.get(path);
  if (e) {
    e.model.pushEditOperations([], [{ range: e.model.getFullModelRange(), text: content }], () => null);
    await saveModel(path);
  } else {
    await api.writeFile(problemId, path, content);
    savedListeners.forEach((fn) => fn(path));
  }
}

/**
 * Pick up changes made outside LLD Studio (another editor, git, etc.).
 * Only clean models are refreshed; unsaved edits always win.
 */
export async function syncFromDisk() {
  for (const [path, e] of [...entries]) {
    if (e.saving || e.model.getAlternativeVersionId() !== e.savedVersion) continue;
    let content: string;
    try {
      content = await api.readFile(e.problemId, path);
    } catch {
      continue; // deleted externally; the tree refresh will show it
    }
    if (content === e.model.getValue() || e.model.getAlternativeVersionId() !== e.savedVersion) continue;
    e.model.pushEditOperations([], [{ range: e.model.getFullModelRange(), text: content }], () => null);
    clearTimeout(e.timer);
    e.savedVersion = e.model.getAlternativeVersionId();
    setDirty(path, false);
  }
}

// --- diagnostics → markers ---------------------------------------------------
function applyMarkers(path: string, model: monaco.editor.ITextModel) {
  const markers = diagnostics
    .filter((d) => d.file === path)
    .map((d) => {
      const line = Math.min(Math.max(d.line, 1), model.getLineCount());
      const word = model.getWordAtPosition({ lineNumber: line, column: d.column });
      return {
        severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
        message: d.message,
        source: 'javac',
        startLineNumber: line,
        startColumn: d.column,
        endLineNumber: line,
        endColumn: word ? word.endColumn : model.getLineMaxColumn(line),
      };
    });
  monaco.editor.setModelMarkers(model, 'javac', markers);
}

export function setDiagnostics(diags: Diagnostic[]) {
  diagnostics = diags;
  useStore.setState({ diagnostics: diags });
  for (const [path, e] of entries) applyMarkers(path, e.model);
}
