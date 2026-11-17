import { api, type Diagnostic } from '../api/client';
import { useStore, allFiles, errorMessage } from './store';
import { closeModel, disposeAll, dropModels, onFileSaved, openModel, remapModels, saveAll, setDiagnostics } from '../editor/models';
import { refreshProjectSymbols } from '../editor/javaCompletion';
import type { monaco } from '../editor/monacoSetup';

const S = () => useStore.getState();

// --- editor registry (so actions can reveal lines in the main editor) -------
export const editors: { code?: monaco.editor.IStandaloneCodeEditor } = {};

// --- session persistence ------------------------------------------------------
let sessionTimer: number | undefined;
function persistSession() {
  const { problem, openTabs, activeTab, activePseudo } = S();
  if (!problem) return;
  clearTimeout(sessionTimer);
  sessionTimer = window.setTimeout(() => api.setState(`session:${problem.id}`, { openTabs, activeTab, activePseudo }).catch(() => {}), 400);
}

// --- problems -------------------------------------------------------------------
let switching: Promise<void> | undefined;

export async function openProblem(id: string) {
  await switching;
  switching = (async () => {
    await disposeAll();
    setDiagnostics([]);
    const problem = await api.problem(id);
    const tree = await api.tree(id);
    useStore.setState({ problem, tree, openTabs: [], activeTab: null, activePseudo: null, lastRunOutput: '' });
    void api.setState('lastProblem', id);
    const session = await api.getState<{ openTabs: string[]; activeTab: string | null; activePseudo: string | null }>(`session:${id}`).catch(() => null);
    const files = new Set(allFiles(tree));
    const tabs = (session?.openTabs ?? []).filter((t) => files.has(t));
    if (!tabs.length) {
      const main = [...files].find((f) => /(^|\/)Main\.java$/.test(f)) ?? [...files].find((f) => f.endsWith('.java'));
      if (main) tabs.push(main);
    }
    const pseudo = session?.activePseudo && files.has(session.activePseudo) ? session.activePseudo : ([...files].find((f) => f.endsWith('.pseudo')) ?? null);
    useStore.setState({
      openTabs: tabs,
      activeTab: session?.activeTab && tabs.includes(session.activeTab) ? session.activeTab : (tabs[0] ?? null),
      activePseudo: pseudo,
    });
    void refreshProjectSymbols(id);
    void liveCheck();
  })().catch((e) => S().toast(`Could not open problem: ${errorMessage(e)}`, 'error'));
  return switching;
}

export async function reloadProblem() {
  const p = S().problem;
  if (p) useStore.setState({ problem: await api.problem(p.id) });
}

// --- tabs -----------------------------------------------------------------------
export function openFile(path: string, line?: number, column = 1) {
  const { openTabs, layout, setLayout } = S();
  if (path.endsWith('.pseudo') && layout.centerMode === 'pseudo') {
    useStore.setState({ activePseudo: path });
    persistSession();
    return;
  }
  useStore.setState({ openTabs: openTabs.includes(path) ? openTabs : [...openTabs, path], activeTab: path });
  if (layout.centerMode !== 'code') setLayout({ centerMode: 'code' });
  persistSession();
  if (line) {
    // Wait for the editor to switch models, then reveal.
    setTimeout(() => {
      const ed = editors.code;
      if (!ed) return;
      ed.revealLineInCenter(line);
      ed.setPosition({ lineNumber: line, column });
      ed.focus();
    }, 80);
  }
}

export async function closeTab(path: string) {
  const { openTabs, activeTab } = S();
  const idx = openTabs.indexOf(path);
  const next = openTabs.filter((t) => t !== path);
  useStore.setState({
    openTabs: next,
    activeTab: activeTab === path ? (next[Math.min(idx, next.length - 1)] ?? null) : activeTab,
  });
  persistSession();
  // Keep models shared with other views (pseudocode / notes panels) alive.
  const { activePseudo } = S();
  if (path !== activePseudo && !['design.md', 'notes.md'].includes(path)) await closeModel(path);
}

export function setActivePseudo(path: string | null) {
  useStore.setState({ activePseudo: path });
  persistSession();
}

useStore.subscribe((s, prev) => {
  if (s.activeTab !== prev.activeTab || s.openTabs !== prev.openTabs) persistSession();
});

// --- file operations used by the explorer -------------------------------------
export async function afterMove(from: string, to: string) {
  await remapModels(from, to);
  const remap = (p: string) => (p === from || p.startsWith(`${from}/`) ? to + p.slice(from.length) : p);
  const { openTabs, activeTab, activePseudo } = S();
  useStore.setState({ openTabs: openTabs.map(remap), activeTab: activeTab && remap(activeTab), activePseudo: activePseudo && remap(activePseudo) });
  await S().refreshTree();
  persistSession();
}

export async function afterDelete(path: string) {
  dropModels(path);
  const gone = (p: string) => p === path || p.startsWith(`${path}/`);
  const { openTabs, activeTab, activePseudo } = S();
  const tabs = openTabs.filter((t) => !gone(t));
  useStore.setState({
    openTabs: tabs,
    activeTab: activeTab && gone(activeTab) ? (tabs[0] ?? null) : activeTab,
    activePseudo: activePseudo && gone(activePseudo) ? null : activePseudo,
  });
  await S().refreshTree();
  persistSession();
}

// --- live error checking --------------------------------------------------------
let checkTimer: number | undefined;
let checkSeq = 0;

export async function liveCheck() {
  const { problem, settings, system } = S();
  if (!problem || !settings?.liveErrors || !system?.jdk.found) return;
  const seq = ++checkSeq;
  try {
    const r = await api.check(problem.id);
    if (seq === checkSeq && S().problem?.id === problem.id && S().runPhase !== 'compiling') setDiagnostics(r.diagnostics);
  } catch {
    /* ignore: e.g. no java files */
  }
}

onFileSaved((path) => {
  if (!path.endsWith('.java')) return;
  const id = S().problem?.id;
  if (id) void refreshProjectSymbols(id);
  clearTimeout(checkTimer);
  checkTimer = window.setTimeout(() => void liveCheck(), 900);
});

// --- run service (WebSocket) ----------------------------------------------------
type TermListener = (text: string, stream: 'stdout' | 'stderr' | 'info' | 'success' | 'error' | 'clear') => void;
const termListeners = new Set<TermListener>();
export const onTerminal = (fn: TermListener) => {
  termListeners.add(fn);
  return () => termListeners.delete(fn);
};
const MAX_TRANSCRIPT = 20_000;
function term(text: string, stream: Parameters<TermListener>[1]) {
  termListeners.forEach((fn) => fn(text, stream));
  if (stream === 'clear') return;
  let t = S().lastRunOutput + text;
  if (t.length > MAX_TRANSCRIPT) t = t.slice(-MAX_TRANSCRIPT);
  useStore.setState({ lastRunOutput: t });
}

let ws: WebSocket | undefined;
let wsReady: Promise<WebSocket> | undefined;

function socket(): Promise<WebSocket> {
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(ws);
  wsReady ??= new Promise((resolve, reject) => {
    const s = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/run`);
    s.onopen = () => {
      ws = s;
      wsReady = undefined;
      resolve(s);
    };
    s.onerror = () => {
      wsReady = undefined;
      reject(new Error('Could not connect to the LLD Studio server'));
    };
    s.onclose = () => {
      if (ws === s) ws = undefined;
      if (S().runPhase !== 'idle') {
        term('\n[connection to server lost]\n', 'error');
        useStore.setState({ runPhase: 'idle' });
      }
    };
    s.onmessage = (ev) => handleRunMessage(JSON.parse(ev.data));
  });
  return wsReady;
}

function handleRunMessage(m: any) {
  switch (m.type) {
    case 'status':
      if (m.phase === 'compiling') {
        useStore.setState({ runPhase: 'compiling' });
        term(`▶ Compiling with javac ${m.jdk}...\n`, 'info');
      } else if (m.phase === 'running') {
        useStore.setState({ runPhase: 'running' });
        term(`▶ Running ${m.mainClass} (timeout ${m.timeoutSec}s)\n\n`, 'info');
      }
      break;
    case 'compile': {
      const diags: Diagnostic[] = m.diagnostics;
      setDiagnostics(diags);
      const errors = diags.filter((d) => d.severity === 'error').length;
      const warnings = diags.length - errors;
      if (m.success) {
        term(`✔ Compiled ${m.fileCount} file(s) in ${m.durationMs} ms${warnings ? ` with ${warnings} warning(s)` : ''}\n`, 'success');
        if (warnings) term(m.output, 'stderr');
      } else {
        term(`✘ Compilation failed (${errors} error(s)) in ${m.durationMs} ms\n\n`, 'error');
        term(m.output, 'stderr');
        useStore.setState({ runPhase: 'idle' });
      }
      break;
    }
    case 'stdout':
      term(m.data, 'stdout');
      break;
    case 'stderr':
      term(m.data, 'stderr');
      break;
    case 'exit': {
      const why = m.timedOut ? ' — killed: time limit exceeded' : m.killed ? ' — stopped' : '';
      term(`\n${m.code === 0 ? '✔' : '✘'} Process exited with code ${m.code ?? m.signal}${why} · ${m.durationMs} ms\n`, m.code === 0 ? 'success' : 'error');
      useStore.setState({ runPhase: 'idle' });
      break;
    }
    case 'error':
      term(`✘ ${m.message}\n`, 'error');
      useStore.setState({ runPhase: 'idle' });
      break;
  }
}

export async function runProject(mainClass?: string, opts: { compileOnly?: boolean } = {}) {
  const { problem, runPhase, setLayout } = S();
  if (!problem || runPhase !== 'idle') return;
  setLayout({ bottomOpen: true, bottomTab: 'terminal' });
  await saveAll();
  term('', 'clear');
  useStore.setState({ lastRunOutput: '', runPhase: 'compiling' });
  try {
    const s = await socket();
    s.send(JSON.stringify(opts.compileOnly ? { type: 'compile', problemId: problem.id } : { type: 'run', problemId: problem.id, mainClass }));
  } catch (e) {
    term(`✘ ${errorMessage(e)}\n`, 'error');
    useStore.setState({ runPhase: 'idle' });
  }
}

export function sendStdin(text: string) {
  if (S().runPhase !== 'running' || !ws) return;
  ws.send(JSON.stringify({ type: 'stdin', data: text }));
  term(text, 'info');
}
export function sendEof() {
  ws?.send(JSON.stringify({ type: 'eof' }));
}
export function stopRun() {
  ws?.send(JSON.stringify({ type: 'kill' }));
}
export const clearTerminal = () => {
  term('', 'clear');
  useStore.setState({ lastRunOutput: '' });
};

// --- misc -------------------------------------------------------------------------
export async function ensureOpen(path: string) {
  await openModel(path);
}

export const flushAll = saveAll;
