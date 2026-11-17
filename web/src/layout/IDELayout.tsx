import { MessageCircleQuestion, NotebookPen, Network, SquareTerminal, CircleAlert, ChevronDown } from 'lucide-react';
import { useStore, type BottomTab } from '../state/store';
import { Splitter } from './Splitter';
import { TopBar } from '../components/TopBar';
import { FileExplorer } from '../components/FileExplorer';
import { CodeEditor } from '../components/CodeEditor';
import { PseudocodeEditor } from '../components/PseudocodeEditor';
import { ProblemWorkspace } from '../components/ProblemWorkspace';
import { AIChatPanel } from '../components/AIChatPanel';
import { ClarificationPanel } from '../components/ClarificationPanel';
import { Terminal } from '../components/Terminal';
import { DesignNotesPanel, DiagnosticsPanel, NotesPanel } from '../components/DocPanels';

const BOTTOM_TABS: { id: BottomTab; label: string; icon: typeof Network; key: string }[] = [
  { id: 'clarify', label: 'Clarification', icon: MessageCircleQuestion, key: 'Alt+Q' },
  { id: 'design', label: 'Design Notes', icon: Network, key: 'Alt+D' },
  { id: 'notes', label: 'Notes', icon: NotebookPen, key: 'Alt+N' },
  { id: 'terminal', label: 'Terminal', icon: SquareTerminal, key: 'Alt+T' },
  { id: 'problems', label: 'Problems', icon: CircleAlert, key: 'Alt+E' },
];

export function IDELayout() {
  const { layout, setLayout, diagnostics, runPhase, problem } = useStore();
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  const maxSide = Math.max(320, window.innerWidth * 0.45);

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        {layout.leftOpen && (
          <>
            <div style={{ width: layout.leftWidth }} className="shrink-0">
              <FileExplorer />
            </div>
            <Splitter direction="horizontal" value={layout.leftWidth} min={160} max={maxSide} onChange={(v) => setLayout({ leftWidth: v })} onDoubleClick={() => setLayout({ leftOpen: false })} />
          </>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            {/* Views stay mounted so editor state survives mode switches. */}
            <div className={layout.centerMode === 'code' ? 'h-full' : 'hidden'}>
              <CodeEditor />
            </div>
            <div className={layout.centerMode === 'pseudo' ? 'h-full' : 'hidden'}>
              <PseudocodeEditor />
            </div>
            {layout.centerMode === 'problem' && <ProblemWorkspace />}
          </div>
          <Splitter direction="vertical" value={layout.bottomHeight} min={34} max={window.innerHeight - 160} invert onChange={(v) => setLayout({ bottomHeight: v, bottomOpen: v > 40 })} />
          <div style={{ height: layout.bottomOpen ? layout.bottomHeight : 34 }} className="flex shrink-0 flex-col bg-panel">
            <div className="flex h-[33px] shrink-0 items-center gap-0.5 border-b border-line px-1">
              {BOTTOM_TABS.map((t) => {
                const active = layout.bottomOpen && layout.bottomTab === t.id;
                return (
                  <button
                    key={t.id}
                    className={`flex h-full items-center gap-1.5 border-b-2 px-2.5 text-[11.5px] tracking-wide uppercase ${active ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'}`}
                    onClick={() => setLayout(active ? { bottomOpen: false } : { bottomTab: t.id, bottomOpen: true })}
                    title={`${t.label} (${t.key})`}
                  >
                    <t.icon size={13} />
                    {t.label}
                    {t.id === 'problems' && diagnostics.length > 0 && (
                      <span className={`rounded-full px-1.5 text-[10px] ${errors ? 'bg-danger text-white' : 'bg-warning text-black'}`}>{errors || warnings}</span>
                    )}
                    {t.id === 'terminal' && runPhase !== 'idle' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />}
                  </button>
                );
              })}
              <button className="icon-btn ml-auto" onClick={() => setLayout({ bottomOpen: !layout.bottomOpen })} title="Toggle panel (Ctrl+J)">
                <ChevronDown size={14} className={layout.bottomOpen ? '' : 'rotate-180'} />
              </button>
            </div>
            <div className={`min-h-0 flex-1 ${layout.bottomOpen ? '' : 'hidden'}`}>
              {problem && (
                <>
                  <div className={layout.bottomTab === 'clarify' ? 'h-full' : 'hidden'}>
                    <ClarificationPanel />
                  </div>
                  <div className={layout.bottomTab === 'design' ? 'h-full' : 'hidden'}>
                    <DesignNotesPanel />
                  </div>
                  <div className={layout.bottomTab === 'notes' ? 'h-full' : 'hidden'}>
                    <NotesPanel />
                  </div>
                  <div className={layout.bottomTab === 'problems' ? 'h-full' : 'hidden'}>
                    <DiagnosticsPanel />
                  </div>
                </>
              )}
              <div className={layout.bottomTab === 'terminal' ? 'h-full' : 'hidden'}>
                <Terminal visible={layout.bottomOpen && layout.bottomTab === 'terminal'} />
              </div>
            </div>
          </div>
        </div>
        {layout.rightOpen && (
          <>
            <Splitter direction="horizontal" value={layout.rightWidth} min={280} max={maxSide} invert onChange={(v) => setLayout({ rightWidth: v })} onDoubleClick={() => setLayout({ rightOpen: false })} />
            <div style={{ width: layout.rightWidth }} className="shrink-0">
              <AIChatPanel />
            </div>
          </>
        )}
      </div>
      <StatusBar />
    </div>
  );
}

function StatusBar() {
  const { problem, activeTab, diagnostics, settings, system, runPhase } = useStore();
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  return (
    <div className="flex h-6 shrink-0 items-center gap-4 bg-accent px-3 text-[11px] text-accent-fg">
      <span>{problem?.title ?? 'No problem'}</span>
      <span>{activeTab ?? ''}</span>
      <span className="ml-auto">{runPhase === 'idle' ? 'Ready' : runPhase === 'compiling' ? 'Compiling…' : 'Running…'}</span>
      <span>
        {errors} error(s) · {diagnostics.length - errors} warning(s)
      </span>
      <span>Autocomplete: {settings?.autocomplete ? 'on' : 'off'}</span>
      <span>{system?.jdk.found ? `JDK ${system.jdk.version}` : 'JDK missing'}</span>
      <span>AI: {settings?.aiProvider === 'openai' ? settings.openaiModel : settings?.aiProvider === 'claude-code' ? `Claude Code${settings.claudeCodeModel ? ` · ${settings.claudeCodeModel}` : ''}` : settings?.anthropicModel}</span>
    </div>
  );
}
