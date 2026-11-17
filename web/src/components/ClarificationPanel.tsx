import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Theater, Lightbulb, ClipboardCheck, SearchCheck, CircleDot, CheckCircle2, Sparkles } from 'lucide-react';
import { api, type Clarification } from '../api/client';
import { useStore, errorMessage } from '../state/store';

const FALLBACK_CATEGORIES = [
  'Functional requirements', 'Non-functional requirements', 'Scale and performance', 'Concurrency', 'Data persistence',
  'Extensibility', 'Failure handling', 'Business rules', 'Edge cases',
];

export function ClarificationPanel() {
  const { problem, toast, requestAi } = useStore();
  const [items, setItems] = useState<Clarification[]>([]);
  const [categories, setCategories] = useState<string[]>(FALLBACK_CATEGORIES);
  const [question, setQuestion] = useState('');
  const [category, setCategory] = useState(FALLBACK_CATEGORIES[0]);
  const [filterCat, setFilterCat] = useState('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'unanswered' | 'answered'>('all');
  const [autoAsk, setAutoAsk] = useState(() => localStorage.getItem('lld:autoAskInterviewer') === '1');

  const load = async () => {
    if (!problem) return;
    try {
      setItems(await api.clarifications(problem.id));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  useEffect(() => {
    void api.categories().then(setCategories).catch(() => {});
  }, []);
  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener('lld:clarifications-changed', onChange);
    return () => window.removeEventListener('lld:clarifications-changed', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem?.id]);

  const add = async () => {
    if (!problem || !question.trim()) return;
    try {
      const c = await api.addClarification(problem.id, { category, question: question.trim() });
      setItems((xs) => [...xs, c]);
      setQuestion('');
      if (autoAsk) requestAi('interviewer_answer', c.question, { clarificationId: c.id });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const update = async (id: string, patch: Partial<Clarification>) => {
    try {
      const c = await api.updateClarification(id, patch);
      setItems((xs) => xs.map((x) => (x.id === id ? c : x)));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const remove = async (id: string) => {
    await api.deleteClarification(id).catch((e) => toast(errorMessage(e), 'error'));
    setItems((xs) => xs.filter((x) => x.id !== id));
  };

  const visible = items.filter((c) => (filterCat === 'all' || c.category === filterCat) && (filterStatus === 'all' || c.status === filterStatus));
  const grouped = useMemo(() => {
    const g = new Map<string, Clarification[]>();
    for (const c of visible) g.set(c.category, [...(g.get(c.category) ?? []), c]);
    return [...g.entries()].sort((a, b) => categories.indexOf(a[0]) - categories.indexOf(b[0]));
  }, [visible, categories]);
  const unanswered = items.filter((c) => c.status === 'unanswered').length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-2 py-1.5">
        <select className="py-1 text-xs" value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <input
          className="min-w-[240px] flex-1 px-2 py-1 text-[13px]"
          placeholder="Question for the interviewer… (Enter to add)"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <button className="btn-primary" onClick={() => void add()} disabled={!question.trim()}>
          <Plus size={13} /> Add
        </button>
        <label className="flex cursor-pointer items-center gap-1 text-xs text-muted" title="When on, each new question is answered by the AI interviewer and the answer is recorded">
          <input
            type="checkbox"
            checked={autoAsk}
            onChange={(e) => {
              setAutoAsk(e.target.checked);
              try {
                localStorage.setItem('lld:autoAskInterviewer', e.target.checked ? '1' : '0');
              } catch {
                /* ignore */
              }
            }}
          />
          <Theater size={12} /> Interviewer simulation
        </label>
        <div className="mx-1 h-4 w-px bg-line" />
        <button className="btn-outline" onClick={() => requestAi('suggest_questions')} title="AI suggests questions you haven't asked">
          <Lightbulb size={13} /> Suggest
        </button>
        <button className="btn-outline" onClick={() => requestAi('requirements_clarity')} title="AI checks whether requirements are clear enough to design">
          <SearchCheck size={13} /> Clear enough?
        </button>
        <button className="btn-outline" onClick={() => requestAi('evaluate_questions')} disabled={!items.length} title="AI evaluates your questions and lists important requirements you missed">
          <ClipboardCheck size={13} /> Evaluate my questions
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-2 px-2 py-1 text-[11px] text-muted">
        <span>
          {items.length} asked · <span className={unanswered ? 'text-warning' : ''}>{unanswered} unanswered</span>
        </span>
        <select className="ml-auto py-0.5 text-[11px]" value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select className="py-0.5 text-[11px]" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}>
          <option value="all">All</option>
          <option value="unanswered">Unanswered</option>
          <option value="answered">Answered</option>
        </select>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {!items.length && (
          <div className="p-4 text-center text-xs text-muted">
            Start the interview by clarifying requirements. Write the questions you would ask, record the interviewer's answers, and use the AI to find gaps.
          </div>
        )}
        {grouped.map(([cat, list]) => (
          <div key={cat} className="mt-2">
            <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
              {cat} <span className="font-normal">({list.length})</span>
            </div>
            <div className="space-y-1.5">
              {list.map((c) => (
                <QuestionRow key={c.id} c={c} categories={categories} onUpdate={update} onDelete={remove} onAsk={() => requestAi('interviewer_answer', c.question, { clarificationId: c.id })} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuestionRow({
  c,
  categories,
  onUpdate,
  onDelete,
  onAsk,
}: {
  c: Clarification;
  categories: string[];
  onUpdate: (id: string, p: Partial<Clarification>) => void;
  onDelete: (id: string) => void;
  onAsk: () => void;
}) {
  const [q, setQ] = useState(c.question);
  const [r, setR] = useState(c.response);
  useEffect(() => setQ(c.question), [c.question]);
  useEffect(() => setR(c.response), [c.response]);
  return (
    <div className="group rounded border border-line bg-elev p-2">
      <div className="flex items-start gap-2">
        {c.status === 'answered' ? (
          <CheckCircle2 size={14} className="mt-1 shrink-0 text-success" aria-label="Answered" />
        ) : (
          <CircleDot size={14} className="mt-1 shrink-0 text-warning" aria-label="Unanswered" />
        )}
        <input
          className="min-w-0 flex-1 border-transparent bg-transparent px-1 py-0.5 text-[13px] font-medium hover:border-line"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => q.trim() && q !== c.question && onUpdate(c.id, { question: q.trim() })}
        />
        {c.source === 'ai' && <Sparkles size={12} className="mt-1.5 shrink-0 text-accent" aria-label="Suggested by AI" />}
        <select className="py-0.5 text-[11px] opacity-60 group-hover:opacity-100" value={c.category} onChange={(e) => onUpdate(c.id, { category: e.target.value })}>
          {categories.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <button className="btn !py-0.5 text-[11px]" onClick={onAsk} title="Ask the AI interviewer and record the answer">
          <Theater size={12} /> Ask AI
        </button>
        <button className="icon-btn opacity-0 group-hover:opacity-100" onClick={() => onDelete(c.id)} title="Delete question">
          <Trash2 size={13} />
        </button>
      </div>
      <textarea
        className="mt-1.5 ml-6 w-[calc(100%-1.5rem)] resize-y px-2 py-1 text-[12.5px]"
        rows={Math.max(1, Math.min(4, r.split('\n').length))}
        placeholder="Interviewer's response…"
        value={r}
        onChange={(e) => setR(e.target.value)}
        onBlur={() => r !== c.response && onUpdate(c.id, { response: r })}
      />
    </div>
  );
}
