import { X, FileCode2, Circle } from 'lucide-react';
import { useStore } from '../state/store';
import { closeTab, editors, runProject } from '../state/actions';
import { saveModel } from '../editor/models';
import { monaco } from '../editor/monacoSetup';
import { MonacoEditor } from './MonacoEditor';
import { FileIcon } from './FileExplorer';

export function EditorTabs() {
  const { openTabs, activeTab, dirty, diagnostics } = useStore();
  return (
    <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-line bg-panel">
      {openTabs.map((path) => {
        const name = path.split('/').pop()!;
        const active = path === activeTab;
        const errs = diagnostics.filter((d) => d.file === path && d.severity === 'error').length;
        return (
          <div
            key={path}
            title={path}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                void closeTab(path);
              } else useStore.setState({ activeTab: path });
            }}
            className={`group flex cursor-pointer items-center gap-1.5 border-r border-line px-3 text-[12.5px] ${
              active ? 'border-t-2 border-t-accent bg-editor text-fg' : 'border-t-2 border-t-transparent text-muted hover:bg-hover'
            }`}
          >
            <FileIcon name={name} />
            <span className={errs ? 'text-danger' : ''}>{name}</span>
            {errs > 0 && <span className="text-[10px] text-danger">{errs}</span>}
            <button
              className="ml-1 flex h-4 w-4 items-center justify-center rounded hover:bg-active"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                void closeTab(path);
              }}
              aria-label={`Close ${name}`}
            >
              {dirty[path] ? <Circle size={8} className="fill-current group-hover:hidden" /> : null}
              <X size={12} className={dirty[path] ? 'hidden group-hover:block' : 'opacity-0 group-hover:opacity-100'} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function CodeEditor() {
  const activeTab = useStore((s) => s.activeTab);
  return (
    <div className="flex h-full min-h-0 flex-col bg-editor">
      <EditorTabs />
      <div className="relative min-h-0 flex-1">
        <MonacoEditor
          path={activeTab}
          onMount={(ed) => {
            editors.code = ed;
            ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
              const p = useStore.getState().activeTab;
              if (p) void saveModel(p);
            });
            ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => void runProject());
            ed.addCommand(monaco.KeyCode.F5, () => void runProject());
          }}
        />
        {!activeTab && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted">
            <FileCode2 size={40} strokeWidth={1} />
            <div className="text-sm">Open a file from the explorer</div>
            <div className="text-xs text-subtle">Ctrl+Enter run · Ctrl+S save · Alt+Shift+F format · Ctrl+F find · Ctrl+H replace</div>
          </div>
        )}
      </div>
    </div>
  );
}
