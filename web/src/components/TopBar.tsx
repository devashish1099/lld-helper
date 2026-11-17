import { useEffect, useState } from 'react';
import {
  Play, Square, Hammer, Sun, Moon, Settings, Keyboard, PanelLeft, PanelRight, PanelBottom, Sparkles, Wand2, LibraryBig, Code2, ListTree, FileText, Coffee,
} from 'lucide-react';
import { api, type ProviderId } from '../api/client';
import { useStore, type CenterMode } from '../state/store';
import { editors, openProblem, runProject, stopRun } from '../state/actions';

export const mainClassKey = (problemId: string) => `lld:main:${problemId}`;

export function TopBar() {
  const { problem, problems, settings, system, layout, setLayout, runPhase, updateSettings, set, dirty } = useStore();
  const [mains, setMains] = useState<string[]>([]);
  const [main, setMain] = useState<string>('');

  const loadMains = async () => {
    if (!problem) return;
    const list = (await api.mainClasses(problem.id).catch(() => [])).map((m) => m.className);
    setMains(list);
    const saved = localStorage.getItem(mainClassKey(problem.id));
    setMain(saved && list.includes(saved) ? saved : (list[0] ?? ''));
  };
  useEffect(() => {
    void loadMains();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem?.id]);

  const unsaved = Object.keys(dirty).length;
  const busy = runPhase !== 'idle';
  const modeBtn = (mode: CenterMode, Icon: typeof Code2, label: string, key: string) => (
    <button
      className={`flex items-center gap-1.5 px-2.5 py-1 text-xs ${layout.centerMode === mode ? 'bg-active text-fg' : 'text-muted hover:text-fg'}`}
      onClick={() => setLayout({ centerMode: mode })}
      title={`${label} (${key})`}
    >
      <Icon size={13} /> {label}
    </button>
  );

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
      <div className="flex items-center gap-1.5 pr-1 font-semibold">
        <span className="rounded bg-accent px-1 py-0.5 font-mono text-[10px] text-accent-fg">LLD</span>
        <span className="text-[13px]">Studio</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted">Problem:</span>
        <select className="max-w-[220px] py-1 text-xs" value={problem?.id ?? ''} onChange={(e) => void openProblem(e.target.value)}>
          {problems.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
        <button className="icon-btn" title="Manage problems (create, import, delete)" onClick={() => set({ dialog: { kind: 'problems' } })}>
          <LibraryBig size={15} />
        </button>
      </div>

      <div className="ml-2 flex overflow-hidden rounded border border-line">
        {modeBtn('code', Code2, 'Java', 'Alt+1')}
        {modeBtn('pseudo', ListTree, 'Pseudocode', 'Alt+2')}
        {modeBtn('problem', FileText, 'Problem', 'Alt+3')}
      </div>

      <div className="ml-2 flex items-center gap-1">
        <select
          className="max-w-[170px] py-1 font-mono text-[11px]"
          value={main}
          onFocus={() => void loadMains()}
          onChange={(e) => {
            setMain(e.target.value);
            if (problem) localStorage.setItem(mainClassKey(problem.id), e.target.value);
          }}
          title="Main class to run"
        >
          {!mains.length && <option value="">no main class</option>}
          {mains.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        {busy ? (
          <button className="btn-primary !bg-danger" onClick={stopRun} title="Stop (Shift+F5)">
            <Square size={13} /> {runPhase === 'compiling' ? 'Compiling…' : 'Stop'}
          </button>
        ) : (
          <button className="btn-primary !bg-success !text-black" onClick={() => void runProject(main || undefined)} disabled={!system?.jdk.found} title="Compile & run (Ctrl+Enter / F5)">
            <Play size={13} className="fill-current" /> Run
          </button>
        )}
        <button className="btn" onClick={() => void runProject(undefined, { compileOnly: true })} disabled={busy || !system?.jdk.found} title="Compile only (Ctrl+Shift+B)">
          <Hammer size={13} />
        </button>
        <button className="btn" onClick={() => editors.code?.getAction('editor.action.formatDocument')?.run()} disabled={layout.centerMode !== 'code'} title="Format document (Alt+Shift+F)">
          <Wand2 size={13} />
        </button>
        <button
          className={`btn border ${settings?.autocomplete ? 'border-accent/60 text-accent' : 'border-line text-muted'}`}
          onClick={() => void updateSettings({ autocomplete: !settings?.autocomplete })}
          title="Toggle Java autocomplete / IntelliSense (Ctrl+Alt+Space). Syntax highlighting is unaffected."
          aria-pressed={!!settings?.autocomplete}
        >
          <Sparkles size={13} /> Autocomplete {settings?.autocomplete ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className="ml-auto flex items-center gap-1">
        {unsaved > 0 && <span className="text-[11px] text-muted">saving {unsaved}…</span>}
        <span
          className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${system?.jdk.found ? 'text-muted' : 'bg-danger/15 text-danger'}`}
          title={system?.jdk.found ? `${system.jdk.javacPath} (${system.jdk.source})` : 'JDK not found - open Settings'}
        >
          <Coffee size={12} /> {system?.jdk.found ? `Java ${system.jdk.major}` : 'No JDK'}
        </span>
        <select className="py-1 text-xs" value={settings?.aiProvider ?? 'anthropic'} onChange={(e) => void updateSettings({ aiProvider: e.target.value as ProviderId })} title="Active AI provider">
          <option value="claude-code">AI: Claude Code (subscription)</option>
          <option value="anthropic">AI: Claude API</option>
          <option value="openai">AI: OpenAI API</option>
        </select>
        <button className={`icon-btn ${layout.leftOpen ? 'text-fg' : ''}`} onClick={() => setLayout({ leftOpen: !layout.leftOpen })} title="Toggle explorer (Ctrl+B)">
          <PanelLeft size={15} />
        </button>
        <button className={`icon-btn ${layout.bottomOpen ? 'text-fg' : ''}`} onClick={() => setLayout({ bottomOpen: !layout.bottomOpen })} title="Toggle bottom panel (Ctrl+J)">
          <PanelBottom size={15} />
        </button>
        <button className={`icon-btn ${layout.rightOpen ? 'text-fg' : ''}`} onClick={() => setLayout({ rightOpen: !layout.rightOpen })} title="Toggle AI assistant (Ctrl+Alt+B)">
          <PanelRight size={15} />
        </button>
        <button className="icon-btn" onClick={() => void updateSettings({ theme: settings?.theme === 'dark' ? 'light' : 'dark' })} title="Toggle light/dark theme">
          {settings?.theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button className="icon-btn" onClick={() => set({ dialog: { kind: 'shortcuts' } })} title="Keyboard shortcuts (Ctrl+/)">
          <Keyboard size={15} />
        </button>
        <button className="icon-btn" onClick={() => set({ dialog: { kind: 'settings' } })} title="Settings">
          <Settings size={15} />
        </button>
      </div>
    </div>
  );
}
