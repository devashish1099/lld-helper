import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, KeyRound, Plus, FolderInput, Trash2, RefreshCw, Coffee } from 'lucide-react';
import { api, type ClaudeCodeStatus, type Problem, type Settings } from '../api/client';
import { useStore, errorMessage } from '../state/store';
import { openProblem } from '../state/actions';
import { Modal, confirmDialog } from './Modal';

const close = () => useStore.setState({ dialog: null });

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[170px_1fr] items-start gap-3 py-2">
      <div className="pt-1 text-xs text-muted">{label}</div>
      <div>
        {children}
        {hint && <div className="mt-1 text-[11px] text-subtle">{hint}</div>}
      </div>
    </div>
  );
}

// --- Java setup status (shared by settings and setup wizard) ------------------------
function JavaStatus() {
  const { system, settings, updateSettings, set, toast } = useStore();
  const [path, setPath] = useState(settings?.jdkPath ?? '');
  const [checking, setChecking] = useState(false);
  const jdk = system?.jdk;
  const recheck = async (jdkPath = path) => {
    setChecking(true);
    try {
      await updateSettings({ jdkPath });
      set({ system: await api.system(true) });
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setChecking(false);
    }
  };
  return (
    <div>
      <div className={`flex items-start gap-2 rounded border p-3 text-xs ${jdk?.found ? 'border-success/40 bg-success/10' : 'border-danger/40 bg-danger/10'}`}>
        {jdk?.found ? <CheckCircle2 size={16} className="shrink-0 text-success" /> : <XCircle size={16} className="shrink-0 text-danger" />}
        {jdk?.found ? (
          <div>
            <div className="font-semibold">JDK {jdk.version} detected</div>
            <div className="font-mono text-muted">
              {jdk.javacPath} · via {jdk.source}
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="font-semibold">No JDK found — Java compilation and execution are unavailable.</div>
            <div className="text-muted">{jdk?.error}</div>
            <div>Install a JDK 17 or newer, then click Re-check:</div>
            <ul className="list-disc pl-4 font-mono text-[11px]">
              <li>Ubuntu/WSL: sudo apt install openjdk-21-jdk</li>
              <li>macOS: brew install openjdk@21</li>
              <li>Windows: winget install EclipseAdoptium.Temurin.21.JDK</li>
            </ul>
            <div>Or set the JDK home directory below (the folder containing bin/javac), or set JAVA_HOME before launching.</div>
          </div>
        )}
      </div>
      <Row label="JDK home (optional)" hint="Leave empty to use JAVA_HOME or the javac on your PATH.">
        <div className="flex gap-1.5">
          <input className="flex-1 px-2 py-1 font-mono text-xs" placeholder="/usr/lib/jvm/java-21-openjdk-amd64" value={path} onChange={(e) => setPath(e.target.value)} />
          <button className="btn-outline" onClick={() => void recheck()} disabled={checking}>
            <RefreshCw size={12} className={checking ? 'animate-spin' : ''} /> Re-check
          </button>
        </div>
      </Row>
    </div>
  );
}

// --- Claude Code (subscription) ----------------------------------------------------------
function ClaudeCodeSection({ compact = false }: { compact?: boolean }) {
  const { settings, updateSettings } = useStore();
  const [status, setStatus] = useState<ClaudeCodeStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [path, setPath] = useState(settings?.claudeCodePath ?? 'claude');
  const [model, setModel] = useState(settings?.claudeCodeModel ?? '');
  const check = async () => {
    setChecking(true);
    try {
      setStatus(await api.claudeCodeStatus());
    } catch (e) {
      setStatus({ found: false, error: errorMessage(e) });
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    void check();
  }, []);
  const ready = status?.found && status.loggedIn;
  return (
    <div className="rounded border border-line p-3">
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold">
        Claude Code — use your Claude subscription (no API key)
        {settings?.aiProvider === 'claude-code' && <span className="rounded bg-accent/15 px-1 text-[10px] font-normal text-accent">active</span>}
      </div>
      <div className={`flex items-start gap-2 text-xs ${ready ? 'text-success' : 'text-warning'}`}>
        {ready ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <XCircle size={14} className="mt-0.5 shrink-0" />}
        <div>
          {!status
            ? 'Checking…'
            : !status.found
              ? 'Claude Code CLI not found. Install it (npm install -g @anthropic-ai/claude-code) or set its path below.'
              : status.loggedIn
                ? `Claude Code ${status.version} · signed in (${status.authMethod ?? 'ok'})`
                : `Claude Code ${status.version} found but not signed in. Run "claude" in a terminal and log in.`}
        </div>
        <button className="icon-btn ml-auto" onClick={() => void check()} title="Re-check">
          <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
        </button>
      </div>
      {!compact && (
        <>
          <Row label="Model" hint="Empty = Claude Code's default. Aliases like opus, sonnet, haiku or full IDs such as claude-sonnet-5-5 work.">
            <input className="w-full px-2 py-1 font-mono text-xs" placeholder="default" value={model} onChange={(e) => setModel(e.target.value)} onBlur={() => model !== settings?.claudeCodeModel && void updateSettings({ claudeCodeModel: model.trim() })} />
          </Row>
          <Row label="CLI path" hint="Command or absolute path of the claude executable.">
            <input
              className="w-full px-2 py-1 font-mono text-xs"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onBlur={async () => {
                if (path === settings?.claudeCodePath) return;
                await updateSettings({ claudeCodePath: path.trim() || 'claude' });
                void check();
              }}
            />
          </Row>
          <p className="text-[11px] text-subtle">
            Runs <code className="font-mono">claude -p</code> locally with all tools, MCP servers and settings disabled, so it only answers. Usage counts against your
            Claude plan's limits. Any ANTHROPIC_API_KEY is hidden from it so your subscription is used.
          </p>
        </>
      )}
      {compact && ready && settings?.aiProvider !== 'claude-code' && (
        <button className="btn-primary mt-2" onClick={() => void updateSettings({ aiProvider: 'claude-code' })}>
          Use Claude Code for AI
        </button>
      )}
    </div>
  );
}

// --- API keys ------------------------------------------------------------------------
function ApiKeys() {
  const { secrets, set, toast, system } = useStore();
  const [values, setValues] = useState({ anthropic: '', openai: '' });
  const save = async (p: 'anthropic' | 'openai') => {
    try {
      await api.setSecret(p, values[p]);
      setValues((v) => ({ ...v, [p]: '' }));
      set({ secrets: await api.secrets() });
      toast('API key saved locally', 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const remove = async (p: 'anthropic' | 'openai') => {
    await api.deleteSecret(p).catch((e) => toast(errorMessage(e), 'error'));
    set({ secrets: await api.secrets() });
  };
  return (
    <>
      {(['anthropic', 'openai'] as const).map((p) => {
        const s = secrets?.[p];
        return (
          <Row
            key={p}
            label={p === 'anthropic' ? 'Anthropic API key' : 'OpenAI API key'}
            hint={
              s?.configured
                ? s.source === 'env'
                  ? `Configured from the ${s.envVar} environment variable.`
                  : `Stored in ${system?.secretsFile} (file mode 600).`
                : `Not configured. Saved to ${system?.secretsFile}; never sent to the browser.`
            }
          >
            <div className="flex items-center gap-1.5">
              <KeyRound size={13} className={s?.configured ? 'text-success' : 'text-muted'} />
              <input
                type="password"
                autoComplete="off"
                className="flex-1 px-2 py-1 font-mono text-xs"
                placeholder={s?.configured ? '•••••••• (configured — enter a new key to replace)' : p === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
                value={values[p]}
                onChange={(e) => setValues((v) => ({ ...v, [p]: e.target.value }))}
              />
              <button className="btn-primary" disabled={!values[p].trim()} onClick={() => void save(p)}>
                Save
              </button>
              {s?.configured && s.source === 'file' && (
                <button className="icon-btn" title="Remove stored key" onClick={() => void remove(p)}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </Row>
        );
      })}
    </>
  );
}

export function SettingsDialog() {
  const { settings, updateSettings, system } = useStore();
  const [tab, setTab] = useState<'general' | 'java' | 'ai'>('general');
  const [local, setLocal] = useState<Settings | null>(settings);
  useEffect(() => setLocal(settings), [settings]);
  if (!local) return null;
  const field = <K extends keyof Settings>(k: K, v: Settings[K]) => setLocal({ ...local, [k]: v });
  const commit = <K extends keyof Settings>(k: K) => local[k] !== settings?.[k] && void updateSettings({ [k]: local[k] } as Partial<Settings>);

  return (
    <Modal title="Settings" onClose={close} width={720}>
      <div className="mb-3 flex gap-1 border-b border-line">
        {(
          [
            ['general', 'General'],
            ['java', 'Java'],
            ['ai', 'AI'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={`px-3 py-1.5 text-xs ${tab === k ? 'border-b-2 border-accent text-fg' : 'text-muted'}`} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'general' && (
        <>
          <Row label="Theme">
            <select className="px-2 py-1 text-xs" value={local.theme} onChange={(e) => void updateSettings({ theme: e.target.value as Settings['theme'] })}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </Row>
          <Row label="Editor font size">
            <input type="number" min={10} max={28} className="w-20 px-2 py-1 text-xs" value={local.fontSize} onChange={(e) => field('fontSize', Number(e.target.value))} onBlur={() => commit('fontSize')} />
          </Row>
          <Row label="Java autocomplete" hint="Completion + parameter hints. Syntax highlighting, formatting and error markers are independent.">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={local.autocomplete} onChange={(e) => void updateSettings({ autocomplete: e.target.checked })} /> Enabled
            </label>
          </Row>
          <Row label="Live error checking" hint="Compiles in the background after each save and underlines javac errors.">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={local.liveErrors} onChange={(e) => void updateSettings({ liveErrors: e.target.checked })} /> Enabled
            </label>
          </Row>
          <Row label="Workspace directory" hint="Project folders live here. Changes take effect after restarting LLD Studio.">
            <input className="w-full px-2 py-1 font-mono text-xs" value={local.workspaceDir} onChange={(e) => field('workspaceDir', e.target.value)} onBlur={() => commit('workspaceDir')} />
            <div className="mt-1 text-[11px] text-subtle">
              Current: <span className="font-mono">{system?.workspaceDir}</span> · App data: <span className="font-mono">{system?.dataDir}</span>
            </div>
          </Row>
        </>
      )}
      {tab === 'java' && (
        <>
          <JavaStatus />
          <Row label="Run timeout (seconds)" hint="Programs are killed after this long. Includes time waiting for stdin.">
            <input type="number" min={1} max={3600} className="w-24 px-2 py-1 text-xs" value={local.runTimeoutSec} onChange={(e) => field('runTimeoutSec', Number(e.target.value))} onBlur={() => commit('runTimeoutSec')} />
          </Row>
          <Row label="Max heap (MB)" hint="Passed to java as -Xmx.">
            <input type="number" min={32} max={8192} className="w-24 px-2 py-1 text-xs" value={local.maxHeapMb} onChange={(e) => field('maxHeapMb', Number(e.target.value))} onBlur={() => commit('maxHeapMb')} />
          </Row>
          <p className="mt-2 text-[11px] text-subtle">Java code runs as a normal process on this machine (not sandboxed), with the project folder as its working directory.</p>
        </>
      )}
      {tab === 'ai' && (
        <>
          <Row label="Active provider">
            <select className="px-2 py-1 text-xs" value={local.aiProvider} onChange={(e) => void updateSettings({ aiProvider: e.target.value as Settings['aiProvider'] })}>
              <option value="claude-code">Claude Code (Claude subscription)</option>
              <option value="anthropic">Anthropic API (Claude)</option>
              <option value="openai">OpenAI API</option>
            </select>
          </Row>
          <ClaudeCodeSection />
          <div className="mt-4 mb-1 text-xs font-semibold">API providers</div>
          <Row label="Anthropic model" hint="e.g. claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5">
            <input className="w-full px-2 py-1 font-mono text-xs" value={local.anthropicModel} onChange={(e) => field('anthropicModel', e.target.value)} onBlur={() => commit('anthropicModel')} />
          </Row>
          <Row label="OpenAI model" hint="Any chat-completions model available to your key.">
            <input className="w-full px-2 py-1 font-mono text-xs" value={local.openaiModel} onChange={(e) => field('openaiModel', e.target.value)} onBlur={() => commit('openaiModel')} />
          </Row>
          <Row label="Max response tokens">
            <input type="number" min={256} max={128000} className="w-28 px-2 py-1 text-xs" value={local.maxTokens} onChange={(e) => field('maxTokens', Number(e.target.value))} onBlur={() => commit('maxTokens')} />
          </Row>
          <ApiKeys />
          <p className="mt-2 text-[11px] text-subtle">AI requests are sent from the local server to the provider. Only the problem, your clarifications, the open file and files you attach are included (review actions include the Java sources).</p>
        </>
      )}
    </Modal>
  );
}

// --- Problem manager -------------------------------------------------------------------
export function ProblemsDialog() {
  const { problems, problem, refreshProblems, toast } = useStore();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [importPath, setImportPath] = useState('');
  const [importTitle, setImportTitle] = useState('');

  const create = async () => {
    try {
      const p = await api.createProblem({ title, description });
      await refreshProblems();
      setTitle('');
      setDescription('');
      close();
      await openProblem(p.id);
      useStore.getState().setLayout({ centerMode: 'problem' });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const doImport = async () => {
    try {
      const p = await api.importProblem(importPath.trim(), importTitle.trim() || undefined);
      await refreshProblems();
      close();
      await openProblem(p.id);
      toast(`Imported into ${p.slug}`, 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const remove = async (p: Problem) => {
    let deleteFiles = false;
    const ok = await confirmDialog(
      'Delete problem',
      <div className="space-y-2">
        <p>
          Delete <b>{p.title}</b> with its clarifications and AI history?
        </p>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" onChange={(e) => (deleteFiles = e.target.checked)} /> Also delete the project folder from disk
        </label>
      </div>,
    );
    if (!ok) return;
    try {
      await api.deleteProblem(p.id, deleteFiles);
      await refreshProblems();
      if (problem?.id === p.id) {
        const next = useStore.getState().problems[0];
        if (next) await openProblem(next.id);
        else useStore.setState({ problem: null, tree: null, openTabs: [], activeTab: null });
      }
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  return (
    <Modal title="LLD problems" onClose={close} width={760}>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2 rounded border border-line p-3">
          <div className="text-xs font-semibold">New problem</div>
          <input className="w-full px-2 py-1 text-[13px]" placeholder="Title, e.g. Vending Machine" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="w-full px-2 py-1 text-[13px]" rows={2} placeholder="Short description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <button className="btn-primary" disabled={!title.trim()} onClick={() => void create()}>
            <Plus size={13} /> Create with Java project
          </button>
        </div>
        <div className="space-y-2 rounded border border-line p-3">
          <div className="text-xs font-semibold">Import existing local project</div>
          <input className="w-full px-2 py-1 font-mono text-xs" placeholder="/home/me/code/my-lld-project or ~/code/x" value={importPath} onChange={(e) => setImportPath(e.target.value)} />
          <input className="w-full px-2 py-1 text-[13px]" placeholder="Title (defaults to folder name)" value={importTitle} onChange={(e) => setImportTitle(e.target.value)} />
          <button className="btn-primary" disabled={!importPath.trim()} onClick={() => void doImport()}>
            <FolderInput size={13} /> Copy into workspace
          </button>
          <p className="text-[11px] text-subtle">The folder is copied (node_modules/.git/build output skipped); your original stays untouched.</p>
        </div>
      </div>
      <div className="mt-4 divide-y divide-line rounded border border-line">
        {problems.map((p) => (
          <div key={p.id} className={`flex items-center gap-3 px-3 py-2 ${p.id === problem?.id ? 'bg-active' : ''}`}>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">
                {p.title} {p.sample ? <span className="ml-1 rounded bg-accent/15 px-1 text-[10px] text-accent">sample</span> : null}
              </div>
              <div className="truncate text-[11px] text-muted">{p.description}</div>
            </div>
            <button
              className="btn-outline"
              onClick={() => {
                close();
                void openProblem(p.id);
              }}
            >
              Open
            </button>
            <button className="icon-btn" title="Delete" onClick={() => void remove(p)}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// --- Shortcuts ---------------------------------------------------------------------------
export const SHORTCUTS: [string, string][] = [
  ['Ctrl+Enter / F5', 'Compile & run'],
  ['Shift+F5', 'Stop running program'],
  ['Ctrl+Shift+B', 'Compile only'],
  ['Ctrl+S', 'Save (autosave is always on)'],
  ['Alt+Shift+F', 'Format Java document'],
  ['Ctrl+F / Ctrl+H', 'Find / Find & replace'],
  ['Ctrl+Space', 'Trigger suggestions'],
  ['Ctrl+Alt+Space', 'Toggle autocomplete on/off'],
  ['Alt+1 / Alt+2 / Alt+3', 'Java / Pseudocode / Problem view'],
  ['Alt+Q / Alt+D / Alt+N / Alt+T / Alt+E', 'Clarifications / Design notes / Notes / Terminal / Problems panel'],
  ['Ctrl+B', 'Toggle file explorer'],
  ['Ctrl+Alt+B', 'Toggle AI assistant'],
  ['Ctrl+J', 'Toggle bottom panel'],
  ['Alt+I', 'Focus AI chat input'],
  ['Ctrl+W (Alt+W in browsers)', 'Close editor tab'],
  ['Ctrl+/', 'Show this list'],
];

export function ShortcutsDialog() {
  return (
    <Modal title="Keyboard shortcuts" onClose={close} width={560}>
      <table className="w-full text-xs">
        <tbody>
          {SHORTCUTS.map(([k, d]) => (
            <tr key={k} className="border-b border-line last:border-0">
              <td className="py-1.5 pr-4 font-mono whitespace-nowrap text-accent">{k}</td>
              <td className="py-1.5">{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

// --- First-run setup -----------------------------------------------------------------------
export function SetupWizard() {
  const { updateSettings, system } = useStore();
  const finish = async () => {
    await updateSettings({ setupComplete: true });
    close();
  };
  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          <Coffee size={16} /> Welcome to LLD Studio
        </span>
      }
      onClose={() => void finish()}
      width={720}
      footer={
        <button className="btn-primary" onClick={() => void finish()}>
          Start practising
        </button>
      }
    >
      <p className="mb-3 text-[13px] text-muted">
        A local IDE for Low-Level Design interviews: clarify requirements, sketch pseudocode, implement in Java, run it, and get AI feedback. Everything is stored on this
        machine — projects in <code className="font-mono">{system?.workspaceDir}</code>.
      </p>
      <div className="mb-1 text-xs font-semibold">1. Java</div>
      <JavaStatus />
      <div className="mt-4 mb-1 text-xs font-semibold">2. AI (optional — needed only for AI features)</div>
      <ClaudeCodeSection compact />
      <div className="mt-3 text-[11px] text-muted">Or use an API key instead:</div>
      <ApiKeys />
      <div className="mt-4 text-xs text-muted">16 sample problems are ready (Parking Lot, Elevator, Amazon Locker, Agentic Chatbot…). Pick one from the Problem menu, or create your own.</div>
    </Modal>
  );
}
