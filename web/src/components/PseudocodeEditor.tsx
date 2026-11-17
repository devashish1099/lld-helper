import { FilePlus, Coffee, ListTree, SearchCheck, ListChecks, GitCompare, ArrowRightLeft } from 'lucide-react';
import { api } from '../api/client';
import { useStore, allFiles, errorMessage } from '../state/store';
import { setActivePseudo } from '../state/actions';
import { MonacoEditor } from './MonacoEditor';
import { promptDialog } from './Modal';

export function PseudocodeEditor() {
  const { tree, activePseudo, problem, dirty, requestAi, toast, refreshTree } = useStore();
  const files = allFiles(tree).filter((f) => f.endsWith('.pseudo'));
  const hasJava = allFiles(tree).some((f) => f.endsWith('.java'));

  const create = async () => {
    if (!problem) return;
    const name = await promptDialog('New pseudocode file', { initial: 'design.pseudo', label: 'Saved in /pseudocode' });
    if (!name) return;
    const path = `pseudocode/${name.endsWith('.pseudo') ? name : `${name}.pseudo`}`;
    try {
      await api.createFile(problem.id, path, `# ${problem.title}\n\n`);
      await refreshTree();
      setActivePseudo(path);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const action = (mode: string) => requestAi(mode, undefined, { pseudoFile: activePseudo ?? undefined });

  return (
    <div className="flex h-full min-h-0 flex-col bg-editor">
      <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-line bg-panel">
        {files.map((f) => (
          <button
            key={f}
            onClick={() => setActivePseudo(f)}
            className={`flex items-center gap-1.5 border-r border-line px-3 text-[12.5px] ${
              f === activePseudo ? 'border-t-2 border-t-accent bg-editor' : 'border-t-2 border-t-transparent text-muted hover:bg-hover'
            }`}
            title={f}
          >
            <ListTree size={13} className="text-[#a074c4]" />
            {f.split('/').pop()}
            {dirty[f] && <span className="h-1.5 w-1.5 rounded-full bg-fg/60" />}
          </button>
        ))}
        <button className="flex items-center px-2 text-muted hover:text-fg" onClick={create} title="New pseudocode file">
          <FilePlus size={14} />
        </button>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line bg-panel px-2 py-1">
        <span className="mr-1 text-[11px] text-muted">AI:</span>
        <button className="btn-outline" disabled={!activePseudo} onClick={() => action('pseudo_to_java')} title="Generate Java files from this pseudocode (you review before anything is written; the pseudocode is kept)">
          <Coffee size={13} /> Generate Java
        </button>
        <button className="btn-outline" disabled={!hasJava} onClick={() => action('java_to_pseudo')} title="Write the current Java implementation as pseudocode (saved as a new file)">
          <ArrowRightLeft size={13} /> Java → Pseudocode
        </button>
        <button className="btn-outline" disabled={!activePseudo} onClick={() => action('review_pseudo')}>
          <SearchCheck size={13} /> Review logic
        </button>
        <button className="btn-outline" disabled={!activePseudo} onClick={() => action('pseudo_missing_cases')}>
          <ListChecks size={13} /> Missing cases
        </button>
        <button className="btn-outline" disabled={!activePseudo || !hasJava} onClick={() => action('compare_impl')}>
          <GitCompare size={13} /> Compare with Java
        </button>
        <span className="ml-auto text-[11px] text-subtle">CLASS · FUNCTION · IF/ELSE · FOR EACH · WHILE · # heading · // comment — Ctrl+Space for snippets</span>
      </div>
      <div className="relative min-h-0 flex-1">
        <MonacoEditor path={activePseudo} autocomplete={false} options={{ tabSize: 4, wordWrap: 'on' }} />
        {!activePseudo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted">
            <ListTree size={36} strokeWidth={1} />
            <div className="text-sm">No pseudocode file yet</div>
            <button className="btn-primary" onClick={create}>
              <FilePlus size={13} /> Create pseudocode file
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

