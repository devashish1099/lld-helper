import { useEffect, useRef, useState } from 'react';
import { monaco } from '../editor/monacoSetup';
import { openModel } from '../editor/models';
import { suggestOptions } from '../editor/javaCompletion';
import { useStore, errorMessage } from '../state/store';

/**
 * A Monaco editor showing the shared model for `path`. View state (cursor, scroll)
 * is remembered per path so switching tabs feels like VS Code.
 */
export function MonacoEditor({
  path,
  onMount,
  options,
  autocomplete = true,
}: {
  path: string | null;
  onMount?: (ed: monaco.editor.IStandaloneCodeEditor) => void;
  options?: monaco.editor.IStandaloneEditorConstructionOptions;
  /** Whether this editor follows the global autocomplete toggle. */
  autocomplete?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor>(undefined);
  const viewStates = useRef(new Map<string, monaco.editor.ICodeEditorViewState | null>());
  const current = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settings = useStore((s) => s.settings);
  // Same relative path in a different problem is a different file.
  const problemId = useStore((s) => s.problem?.id);

  useEffect(() => {
    const ed = monaco.editor.create(host.current!, {
      automaticLayout: true,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace",
      fontSize: settings?.fontSize ?? 14,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      tabSize: 4,
      insertSpaces: true,
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: 'active', indentation: true },
      matchBrackets: 'always',
      renderWhitespace: 'selection',
      smoothScrolling: true,
      fixedOverflowWidgets: true,
      model: null,
      ...options,
    });
    editor.current = ed;
    onMount?.(ed);
    return () => {
      ed.dispose();
      editor.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ed = editor.current;
    if (!ed) return;
    const key = path && `${problemId}:${path}`;
    if (current.current) viewStates.current.set(current.current, ed.saveViewState());
    current.current = key;
    setError(null);
    if (!path) {
      ed.setModel(null);
      return;
    }
    let cancelled = false;
    openModel(path)
      .then((model) => {
        if (cancelled || current.current !== key) return;
        ed.setModel(model);
        const vs = viewStates.current.get(key!);
        if (vs) ed.restoreViewState(vs);
      })
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [path, problemId]);

  useEffect(() => {
    if (!settings) return;
    monaco.editor.setTheme(settings.theme === 'dark' ? 'lld-dark' : 'lld-light');
    editor.current?.updateOptions({
      fontSize: settings.fontSize,
      ...(autocomplete ? suggestOptions(settings.autocomplete) : {}),
    });
  }, [settings?.theme, settings?.fontSize, settings?.autocomplete, autocomplete]);

  return (
    <div className="relative h-full w-full">
      <div ref={host} className="absolute inset-0" />
      {error && <div className="absolute inset-0 flex items-center justify-center bg-editor p-4 text-sm text-danger">{error}</div>}
    </div>
  );
}
