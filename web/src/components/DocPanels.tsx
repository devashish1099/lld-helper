import { useEffect, useState } from 'react';
import { Columns2, Eye, PencilLine, FilePlus, CircleX, TriangleAlert } from 'lucide-react';
import { api } from '../api/client';
import { useStore, allFiles, errorMessage } from '../state/store';
import { getModel, onFileSaved } from '../editor/models';
import { openFile } from '../state/actions';
import { MonacoEditor } from './MonacoEditor';
import { Markdown } from './Markdown';

function useFileExists(path: string) {
  const tree = useStore((s) => s.tree);
  return allFiles(tree).includes(path);
}

function CreateFile({ path, template }: { path: string; template: string }) {
  const { problem, toast, refreshTree } = useStore();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted">
      <div>
        <code className="font-mono">{path}</code> does not exist in this project.
      </div>
      <button
        className="btn-primary"
        onClick={async () => {
          try {
            await api.createFile(problem!.id, path, template);
            await refreshTree();
          } catch (e) {
            toast(errorMessage(e), 'error');
          }
        }}
      >
        <FilePlus size={13} /> Create {path}
      </button>
    </div>
  );
}

/** design.md with a live Markdown + Mermaid class-diagram preview. */
export function DesignNotesPanel() {
  const exists = useFileExists('design.md');
  const [view, setView] = useState<'split' | 'edit' | 'preview'>(() => (localStorage.getItem('lld:designView') as 'split') || 'split');
  const [text, setText] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem('lld:designView', view);
    } catch {
      /* ignore */
    }
  }, [view]);

  // Preview follows the shared model; poll lightly for edits made in the editor.
  const problemId = useStore((s) => s.problem?.id);
  useEffect(() => {
    setText('');
    if (!exists) return;
    let last = '';
    const tick = () => {
      const v = getModel('design.md')?.getValue();
      if (v !== undefined && v !== last) {
        last = v;
        setText(v);
      }
    };
    const id = window.setInterval(tick, 700);
    tick();
    const off = onFileSaved((p) => p === 'design.md' && tick());
    return () => {
      clearInterval(id);
      off();
    };
  }, [exists, problemId]);

  if (!exists) return <CreateFile path="design.md" template={'# Design Notes\n\n```mermaid\nclassDiagram\n    class Main\n```\n'} />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-0.5 text-[11px] text-muted">
        <span>design.md · Markdown with ```mermaid class diagrams</span>
        <div className="ml-auto flex">
          {(
            [
              ['edit', PencilLine],
              ['split', Columns2],
              ['preview', Eye],
            ] as const
          ).map(([v, Icon]) => (
            <button key={v} className={`icon-btn ${view === v ? 'bg-active text-fg' : ''}`} onClick={() => setView(v)} title={v}>
              <Icon size={13} />
            </button>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {view !== 'preview' && (
          <div className={view === 'split' ? 'w-1/2 border-r border-line' : 'w-full'}>
            <MonacoEditor path="design.md" autocomplete={false} options={{ wordWrap: 'on', lineNumbers: 'off', fontSize: 13 }} />
          </div>
        )}
        {view !== 'edit' && (
          <div className={`${view === 'split' ? 'w-1/2' : 'w-full'} overflow-auto bg-editor p-3`}>
            <Markdown text={text} mermaid />
          </div>
        )}
      </div>
    </div>
  );
}

export function NotesPanel() {
  const exists = useFileExists('notes.md');
  if (!exists) return <CreateFile path="notes.md" template="# Notes\n\n" />;
  return <MonacoEditor path="notes.md" autocomplete={false} options={{ wordWrap: 'on', lineNumbers: 'off', fontSize: 13 }} />;
}

export function DiagnosticsPanel() {
  const diagnostics = useStore((s) => s.diagnostics);
  if (!diagnostics.length) return <div className="p-3 text-xs text-muted">No problems detected in the project.</div>;
  return (
    <div className="h-full overflow-auto py-1 font-mono text-[12px]">
      {diagnostics.map((d, i) => (
        <button key={i} className="flex w-full items-start gap-2 px-3 py-0.5 text-left hover:bg-hover" onClick={() => openFile(d.file, d.line, d.column)}>
          {d.severity === 'error' ? <CircleX size={13} className="mt-0.5 shrink-0 text-danger" /> : <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warning" />}
          <span className="min-w-0 flex-1 whitespace-pre-wrap">{d.message}</span>
          <span className="shrink-0 text-muted">
            {d.file.split('/').pop()}:{d.line}:{d.column}
          </span>
        </button>
      ))}
    </div>
  );
}
