import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Send, Square, Trash2, Paperclip, X, Sparkles, UserRound, FileCode2, Wand2, ChevronDown, Theater, KeyRound, FolderTree } from 'lucide-react';
import { api, streamAi, type ChatMessage, type ProviderId } from '../api/client';
import { useStore, allFiles, errorMessage } from '../state/store';
import { flushAll } from '../state/actions';
import { Markdown } from './Markdown';
import { savePseudoFromText, showGeneratedFiles, showSuggestions } from './aiResults';

type Thread = 'assistant' | 'interviewer';
const threadFor = (mode: string): Thread => (mode === 'interviewer' || mode === 'interviewer_answer' ? 'interviewer' : 'assistant');

const MODE_LABELS: Record<string, string> = {
  interviewer_answer: 'Clarification',
  suggest_questions: 'Suggest questions',
  evaluate_questions: 'Evaluate questions',
  requirements_clarity: 'Requirements check',
  pseudo_to_java: 'Pseudocode → Java',
  java_to_pseudo: 'Java → Pseudocode',
  review_pseudo: 'Review pseudocode',
  pseudo_missing_cases: 'Missing cases',
  compare_impl: 'Compare with Java',
  design_review: 'Design review',
  solid_review: 'SOLID check',
  edge_cases: 'Edge cases',
  debug_error: 'Debug error',
};

const QUICK_ACTIONS: { mode: string; label: string; message?: string }[] = [
  { mode: 'design_review', label: 'Review overall design & architecture' },
  { mode: 'solid_review', label: 'Find SOLID violations' },
  { mode: 'edge_cases', label: 'Find missing edge cases' },
  { mode: 'debug_error', label: 'Help debug the last compile/run error' },
  { mode: 'chat', label: 'Review class relationships in the open file', message: 'Review the class relationships (composition, aggregation, inheritance, dependencies) in the open file and suggest improvements.' },
  { mode: 'chat', label: 'Explain trade-offs of my approach', message: 'Explain the trade-offs of the design approach in the open file compared to the main alternatives.' },
  { mode: 'chat', label: 'Which design patterns fit this problem?', message: 'Which design patterns fit this problem and where exactly would each apply? Keep it brief.' },
];

interface Streaming {
  thread: Thread;
  mode: string;
  user: string;
  text: string;
  extra?: Record<string, unknown>;
}

export function AIChatPanel() {
  const { problem, settings, secrets, activeTab, aiAttachments, aiRequest, tree, updateSettings, toast, set } = useStore();
  const [thread, setThread] = useState<Thread>(() => (localStorage.getItem('lld:aiThread') as Thread) || 'assistant');
  const [messages, setMessages] = useState<Record<Thread, ChatMessage[]>>({ assistant: [], interviewer: [] });
  const [input, setInput] = useState('');
  const [includeActive, setIncludeActive] = useState(true);
  const [includeProject, setIncludeProject] = useState(false);
  const [streaming, setStreaming] = useState<Streaming | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [attachFilter, setAttachFilter] = useState('');
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const handledRequest = useRef(0);

  const provider = settings?.aiProvider ?? 'anthropic';
  const model = provider === 'anthropic' ? settings?.anthropicModel : provider === 'openai' ? settings?.openaiModel : settings?.claudeCodeModel || 'default model';
  // Claude Code authenticates through its own sign-in; errors (e.g. signed out) surface on send.
  const keyConfigured = provider === 'claude-code' || !!secrets?.[provider]?.configured;

  const switchThread = (t: Thread) => {
    setThread(t);
    try {
      localStorage.setItem('lld:aiThread', t);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!problem) return;
    let cancelled = false;
    Promise.all([api.thread(problem.id, 'assistant'), api.thread(problem.id, 'interviewer')])
      .then(([assistant, interviewer]) => !cancelled && setMessages({ assistant, interviewer }))
      .catch(() => {});
    setError(null);
    return () => {
      cancelled = true;
    };
  }, [problem?.id]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, streaming?.text, thread]);

  const send = useCallback(
    async (mode: string, text: string, extra: Record<string, unknown> = {}) => {
      if (!problem || streaming) return;
      const t = threadFor(mode);
      switchThread(t);
      setError(null);
      await flushAll(); // AI reads files from disk: make sure edits are saved
      const st = useStore.getState();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setStreaming({ thread: t, mode, user: text || MODE_LABELS[mode] || '', text: '', extra });
      let full = '';
      try {
        full = await streamAi(
          {
            problemId: problem.id,
            mode,
            message: text,
            provider: st.settings?.aiProvider,
            activeFile: st.activeTab ?? undefined,
            includeActiveFile: includeActive,
            includeProject,
            attachedFiles: st.aiAttachments,
            pseudoFile: (extra.pseudoFile as string) ?? st.activePseudo ?? undefined,
            runOutput: mode === 'debug_error' ? st.lastRunOutput : (extra.runOutput as string | undefined),
          },
          {
            onStart: (e) => setStreaming((s) => s && { ...s, user: e.userMessage.content }),
            onDelta: (d) => setStreaming((s) => s && { ...s, text: s.text + d }),
          },
          ctrl.signal,
        );
      } catch (e) {
        if (!ctrl.signal.aborted) setError(errorMessage(e));
      } finally {
        abort.current = null;
        setStreaming(null);
        const fresh = await api.thread(problem.id, t).catch(() => null);
        if (fresh) setMessages((m) => ({ ...m, [t]: fresh }));
      }
      if (!full) return;
      // Post-process structured modes.
      if (mode === 'interviewer_answer' && extra.clarificationId) {
        await api.updateClarification(extra.clarificationId as string, { response: full.trim() }).catch((e) => toast(errorMessage(e), 'error'));
        window.dispatchEvent(new Event('lld:clarifications-changed'));
      }
      if (mode === 'pseudo_to_java') showGeneratedFiles(full);
      if (mode === 'java_to_pseudo') void savePseudoFromText(full);
      if (mode === 'suggest_questions') showSuggestions(full);
    },
    [problem, streaming, includeActive, includeProject, toast],
  );

  // Requests from other panels (clarification, pseudocode).
  useEffect(() => {
    if (!aiRequest || aiRequest.id === handledRequest.current) return;
    handledRequest.current = aiRequest.id;
    if (streaming) {
      toast('Wait for the current AI response to finish (or stop it).', 'info');
      return;
    }
    void send(aiRequest.mode, aiRequest.message ?? '', aiRequest.extra);
  }, [aiRequest, send, streaming, toast]);

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    void send(thread === 'interviewer' ? 'interviewer' : 'chat', text);
  };

  const list = messages[thread];
  const files = allFiles(tree).filter((f) => !aiAttachments.includes(f) && f.toLowerCase().includes(attachFilter.toLowerCase()));

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        <button className={`btn ${thread === 'assistant' ? 'bg-active' : ''}`} onClick={() => switchThread('assistant')} title="LLD coach: concepts, reviews, debugging">
          <Bot size={14} /> Assistant
        </button>
        <button
          className={`btn ${thread === 'interviewer' ? 'bg-active text-warning' : ''}`}
          onClick={() => switchThread('interviewer')}
          title="Interviewer simulation: ask clarification questions; the AI answers like an interviewer and won't reveal the design"
        >
          <Theater size={14} /> Interviewer
        </button>
        <div className="ml-auto flex items-center gap-1">
          <select
            className="max-w-[150px] py-0.5 text-[11px]"
            value={provider}
            onChange={(e) => void updateSettings({ aiProvider: e.target.value as ProviderId })}
            title={`Model: ${model}`}
          >
            <option value="claude-code">Claude Code · {settings?.claudeCodeModel || 'default'}</option>
            <option value="anthropic">Claude API · {settings?.anthropicModel}</option>
            <option value="openai">OpenAI API · {settings?.openaiModel}</option>
          </select>
          <button
            className="icon-btn"
            title={`Clear ${thread} conversation`}
            disabled={!list.length || !!streaming}
            onClick={async () => {
              if (!problem) return;
              await api.clearThread(problem.id, thread);
              setMessages((m) => ({ ...m, [thread]: [] }));
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {thread === 'interviewer' && (
        <div className="shrink-0 border-b border-line bg-warning/10 px-3 py-1.5 text-[11.5px] text-warning">
          Interviewer simulation is on. Ask clarification questions or share your code to walk through it; the interviewer won't reveal or write the solution.
        </div>
      )}

      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {!keyConfigured && (
          <div className="rounded border border-line bg-elev p-3 text-xs">
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              <KeyRound size={13} /> No {provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key configured
            </div>
            <p className="text-muted">
              Add a key in Settings → AI (stored locally in <code className="font-mono">~/.lld-studio/.env</code>, never sent to the browser), or set{' '}
              <code className="font-mono">{secrets?.[provider]?.envVar}</code> before starting. Or switch to <b>Claude Code</b> to use your Claude
              subscription without an API key.
            </p>
            <button className="btn-primary mt-2" onClick={() => set({ dialog: { kind: 'settings' } })}>
              Open settings
            </button>
          </div>
        )}
        {!list.length && !streaming && keyConfigured && (
          <div className="pt-6 text-center text-xs text-muted">
            {thread === 'assistant' ? (
              <>
                <Sparkles className="mx-auto mb-2" size={22} strokeWidth={1.5} />
                Ask about OOP, SOLID, design patterns, concurrency or Java APIs.
                <br />
                The open file and attached files are sent as context.
              </>
            ) : (
              <>
                <Theater className="mx-auto mb-2" size={22} strokeWidth={1.5} />
                You're interviewing for: <b>{problem?.title}</b>.<br />
                Start by asking clarification questions. Later, share the open file or attach files to walk the interviewer through your code.
              </>
            )}
          </div>
        )}
        {list.map((m) => (
          <MessageView key={m.id} m={m} />
        ))}
        {streaming && streaming.thread === thread && (
          <>
            <MessageView m={{ id: 'u', role: 'user', content: streaming.user, mode: streaming.mode, created_at: '' }} />
            <div className="flex gap-2">
              <div className="mt-0.5 shrink-0 text-accent">{thread === 'interviewer' ? <Theater size={15} /> : <Bot size={15} />}</div>
              <div className="min-w-0 flex-1 text-[13px]">
                {streaming.text ? <Markdown text={streaming.text} /> : <span className="animate-pulse text-muted">Thinking…</span>}
              </div>
            </div>
          </>
        )}
        {error && <div className="rounded border border-danger/40 bg-danger/10 p-2 text-xs text-danger">{error}</div>}
      </div>

      <div className="shrink-0 border-t border-line p-2">
        <div className="mb-1.5 flex flex-wrap items-center gap-1">
            <label className="flex cursor-pointer items-center gap-1 rounded px-1 text-[11px] text-muted" title={thread === 'interviewer' ? 'Show the currently open file to the interviewer' : 'Send the currently open file as context'}>
              <input type="checkbox" checked={includeActive} onChange={(e) => setIncludeActive(e.target.checked)} />
              <FileCode2 size={12} /> {activeTab ? activeTab.split('/').pop() : 'open file'}
            </label>
            <label className="flex cursor-pointer items-center gap-1 rounded px-1 text-[11px] text-muted" title="Send every Java file and the pseudocode (large projects are truncated to fit the context budget)">
              <input type="checkbox" checked={includeProject} onChange={(e) => setIncludeProject(e.target.checked)} />
              <FolderTree size={12} /> whole project
            </label>
            {aiAttachments.map((f) => (
              <span key={f} className="flex items-center gap-1 rounded bg-active px-1.5 py-0.5 text-[11px]" title={f}>
                <Paperclip size={10} /> {f.split('/').pop()}
                <button onClick={() => set({ aiAttachments: aiAttachments.filter((x) => x !== f) })} aria-label={`Remove ${f}`}>
                  <X size={10} />
                </button>
              </span>
            ))}
            <div className="relative">
              <button className="btn !px-1 !py-0.5 text-[11px] text-muted" onClick={() => setShowAttach(!showAttach)}>
                <Paperclip size={11} /> Attach
              </button>
              {showAttach && (
                <div className="absolute bottom-7 left-0 z-30 w-72 rounded border border-line bg-elev shadow-xl">
                  <input autoFocus className="m-1 w-[calc(100%-8px)] px-2 py-1 text-xs" placeholder="Filter files…" value={attachFilter} onChange={(e) => setAttachFilter(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setShowAttach(false)} />
                  <div className="max-h-60 overflow-auto pb-1">
                    {files.map((f) => (
                      <button
                        key={f}
                        className="block w-full truncate px-2 py-1 text-left font-mono text-[11px] hover:bg-hover"
                        onClick={() => {
                          set({ aiAttachments: [...aiAttachments, f] });
                          setShowAttach(false);
                          setAttachFilter('');
                        }}
                      >
                        {f}
                      </button>
                    ))}
                    {!files.length && <div className="px-2 py-1 text-[11px] text-muted">No files</div>}
                  </div>
                </div>
              )}
            </div>
            {thread === 'assistant' && (
            <div className="relative ml-auto">
              <button className="btn !px-1 !py-0.5 text-[11px]" onClick={() => setShowActions(!showActions)} disabled={!!streaming}>
                <Wand2 size={11} /> Review <ChevronDown size={11} />
              </button>
              {showActions && (
                <div className="absolute right-0 bottom-7 z-30 w-72 rounded border border-line bg-elev py-1 shadow-xl" onMouseLeave={() => setShowActions(false)}>
                  {QUICK_ACTIONS.map((a) => (
                    <button
                      key={a.label}
                      className="block w-full px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-fg"
                      onClick={() => {
                        setShowActions(false);
                        void send(a.mode, a.message ?? '');
                      }}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            )}
        </div>
        <div className="flex items-end gap-1.5">
          <textarea
            className="max-h-40 min-h-[38px] flex-1 resize-none px-2 py-1.5 text-[13px]"
            rows={Math.min(6, Math.max(1, input.split('\n').length))}
            placeholder={thread === 'interviewer' ? 'Talk to the interviewer: clarify requirements, walk through your code, ask what comes next…' : 'Ask about your design, Java, patterns… (Enter to send, Shift+Enter newline)'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {streaming ? (
            <button className="btn-primary !bg-danger h-[38px]" onClick={() => abort.current?.abort()} title="Stop">
              <Square size={13} />
            </button>
          ) : (
            <button className="btn-primary h-[38px]" onClick={submit} disabled={!input.trim()} title="Send">
              <Send size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageView({ m }: { m: ChatMessage }) {
  const label = MODE_LABELS[m.mode];
  if (m.role === 'user')
    return (
      <div className="flex gap-2">
        <UserRound size={15} className="mt-0.5 shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          {label && <div className="mb-0.5 text-[10px] font-semibold tracking-wide text-accent uppercase">{label}</div>}
          <div className="text-[13px] whitespace-pre-wrap">{m.content}</div>
        </div>
      </div>
    );
  const interviewer = m.mode === 'interviewer' || m.mode === 'interviewer_answer';
  return (
    <div className="flex gap-2">
      <div className="mt-0.5 shrink-0 text-accent">{interviewer ? <Theater size={15} /> : <Bot size={15} />}</div>
      <div className="min-w-0 flex-1 text-[13px]">
        <Markdown text={m.content} />
        {m.mode === 'pseudo_to_java' && /=== FILE:/.test(m.content) && (
          <button className="btn-outline mt-2" onClick={() => showGeneratedFiles(m.content)}>
            Review & write generated files
          </button>
        )}
        {m.mode === 'java_to_pseudo' && (
          <button className="btn-outline mt-2" onClick={() => void savePseudoFromText(m.content)}>
            Save as new pseudocode file
          </button>
        )}
        {m.mode === 'suggest_questions' && (
          <button className="btn-outline mt-2" onClick={() => showSuggestions(m.content)}>
            Add suggested questions
          </button>
        )}
      </div>
    </div>
  );
}
