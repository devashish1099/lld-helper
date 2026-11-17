import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, FolderOpen } from 'lucide-react';
import { api, type Problem } from '../api/client';
import { useStore, errorMessage } from '../state/store';

type Field = 'title' | 'description' | 'functional_reqs' | 'non_functional_reqs' | 'interviewer_notes';

/** Problem statement editor: title, description, requirements and (hidden) interviewer notes. */
export function ProblemWorkspace() {
  const { problem, toast, refreshProblems } = useStore();
  const [draft, setDraft] = useState<Problem | null>(problem);
  const [showNotes, setShowNotes] = useState(false);
  const [saved, setSaved] = useState(true);
  const timer = useRef<number>(undefined);

  useEffect(() => {
    setDraft(problem);
    setShowNotes(false);
    setSaved(true);
  }, [problem?.id]);

  if (!problem || !draft) return null;

  const change = (field: Field, value: string) => {
    const next = { ...draft, [field]: value };
    setDraft(next);
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const p = await api.updateProblem(problem.id, { [field]: value });
        useStore.setState((s) => ({ problem: s.problem?.id === p.id ? { ...s.problem, ...p } : s.problem }));
        setSaved(true);
        if (field === 'title') void refreshProblems();
      } catch (e) {
        toast(errorMessage(e), 'error');
      }
    }, 600);
  };

  const area = (field: Field, label: string, rows: number, placeholder: string) => (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold tracking-wide text-muted uppercase">{label}</span>
      <textarea className="w-full resize-y px-3 py-2 font-mono text-[13px] leading-relaxed" rows={rows} placeholder={placeholder} value={draft[field] ?? ''} onChange={(e) => change(field, e.target.value)} />
    </label>
  );

  return (
    <div className="h-full overflow-auto bg-editor">
      <div className="mx-auto max-w-3xl space-y-4 px-6 py-5">
        <div className="flex items-center gap-2">
          <input className="min-w-0 flex-1 border-transparent bg-transparent px-1 py-1 text-xl font-semibold hover:border-line" value={draft.title} onChange={(e) => change('title', e.target.value)} />
          <span className="text-[11px] text-subtle">{saved ? 'Saved' : 'Saving…'}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-subtle" title="Project files on disk">
          <FolderOpen size={12} /> <span className="font-mono select-all">{problem.projectDir}</span>
        </div>
        {area('description', 'Problem description', 4, 'What are we designing?')}
        {area('functional_reqs', 'Functional requirements', 6, '- Users can ...')}
        {area('non_functional_reqs', 'Non-functional requirements', 4, '- Thread-safe ...')}
        <div className="rounded border border-dashed border-line p-3">
          <button className="btn !px-0" onClick={() => setShowNotes(!showNotes)}>
            {showNotes ? <EyeOff size={13} /> : <Eye size={13} />}
            {showNotes ? 'Hide' : 'Reveal'} interviewer notes (spoilers)
          </button>
          <p className="mt-1 text-[11px] text-subtle">
            Hidden facts the AI interviewer uses to answer clarification questions consistently. Leave them hidden while practising; edit them to create your own problems.
          </p>
          {showNotes && <div className="mt-2">{area('interviewer_notes', 'Interviewer notes', 8, '- Only cars and bikes\n- 3 floors ...')}</div>}
        </div>
      </div>
    </div>
  );
}
