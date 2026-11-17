import { useEffect, useState } from 'react';
import { CircleX, CheckCircle2, Info, Loader2 } from 'lucide-react';
import { api } from './api/client';
import { useStore, DEFAULT_LAYOUT, errorMessage, type Layout } from './state/store';
import { closeTab, editors, openProblem, runProject, stopRun } from './state/actions';
import { setJavaAutocomplete } from './editor/javaCompletion';
import { saveAll, syncFromDisk } from './editor/models';
import { IDELayout } from './layout/IDELayout';
import { ProblemsDialog, SettingsDialog, SetupWizard, ShortcutsDialog } from './components/Dialogs';

export function App() {
  const { settings, dialog, toasts, problem } = useStore();
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [system, settings, secrets, problems, layout, last] = await Promise.all([
        api.system(),
        api.settings(),
        api.secrets(),
        api.problems(),
        api.getState<Layout>('layout'),
        api.getState<string>('lastProblem'),
      ]);
      useStore.setState({ system, settings, secrets, problems, layout: { ...DEFAULT_LAYOUT, ...(layout ?? useStore.getState().layout) } });
      if (system.firstRun || !system.jdk.found) useStore.setState({ dialog: { kind: 'setup' } });
      const start = problems.find((p) => p.id === last) ?? problems[0];
      if (start) await openProblem(start.id);
    })().catch((e) => setBootError(errorMessage(e)));
  }, []);

  // Theme + autocomplete toggle follow settings.
  useEffect(() => {
    if (!settings) return;
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
    setJavaAutocomplete(settings.autocomplete);
  }, [settings?.theme, settings?.autocomplete]);

  useEffect(() => {
    document.title = problem ? `${problem.title} · LLD Studio` : 'LLD Studio';
  }, [problem?.title]);

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const { setLayout, layout } = s;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (ctrl && !e.shiftKey && !e.altKey && k === 's') return handled(), void saveAll();
      if (ctrl && k === 'enter') return handled(), void runProject();
      if (e.key === 'F5' && !e.shiftKey) return handled(), void runProject();
      if (e.key === 'F5' && e.shiftKey) return handled(), stopRun();
      if (ctrl && e.shiftKey && k === 'b') return handled(), void runProject(undefined, { compileOnly: true });
      if (ctrl && e.altKey && k === 'b') return handled(), setLayout({ rightOpen: !layout.rightOpen });
      if (ctrl && !e.altKey && !e.shiftKey && k === 'b') return handled(), setLayout({ leftOpen: !layout.leftOpen });
      if (ctrl && k === 'j') return handled(), setLayout({ bottomOpen: !layout.bottomOpen });
      if (ctrl && e.altKey && e.code === 'Space') return handled(), void s.updateSettings({ autocomplete: !s.settings?.autocomplete });
      if (ctrl && k === '/') {
        // Leave Ctrl+/ to Monaco (toggle comment) when an editor has focus.
        if (editors.code?.hasTextFocus() || document.activeElement?.closest('.monaco-editor')) return;
        return handled(), s.set({ dialog: { kind: 'shortcuts' } });
      }
      if (e.altKey && !ctrl) {
        const modes: Record<string, Layout['centerMode']> = { Digit1: 'code', Digit2: 'pseudo', Digit3: 'problem' };
        const tabs: Record<string, Layout['bottomTab']> = { KeyQ: 'clarify', KeyD: 'design', KeyN: 'notes', KeyT: 'terminal', KeyE: 'problems' };
        if (modes[e.code]) return handled(), setLayout({ centerMode: modes[e.code] });
        if (tabs[e.code]) return handled(), setLayout({ bottomOpen: true, bottomTab: tabs[e.code] });
        if (e.code === 'KeyW' && s.activeTab) return handled(), void closeTab(s.activeTab);
        if (e.code === 'KeyI') {
          handled();
          if (!layout.rightOpen) setLayout({ rightOpen: true });
          setTimeout(() => document.querySelector<HTMLTextAreaElement>('textarea[placeholder^="Ask"]')?.focus(), 50);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (Object.keys(useStore.getState().dirty).length) {
        void saveAll();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    // Returning to the tab: reload files changed on disk by other tools.
    const onFocus = () => {
      void syncFromDisk();
      void useStore.getState().refreshTree().catch(() => {});
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  if (bootError)
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded border border-danger/40 bg-danger/10 p-4 text-sm">
          <div className="mb-1 font-semibold text-danger">Cannot reach the LLD Studio server</div>
          <div className="text-muted">{bootError}</div>
          <div className="mt-2 text-xs">
            Start it with <code className="font-mono">npm start</code> in the project folder, then reload.
          </div>
        </div>
      </div>
    );
  if (!settings)
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted">
        <Loader2 className="animate-spin" size={18} /> Loading LLD Studio…
      </div>
    );

  return (
    <>
      <IDELayout />
      {dialog?.kind === 'settings' && <SettingsDialog />}
      {dialog?.kind === 'problems' && <ProblemsDialog />}
      {dialog?.kind === 'shortcuts' && <ShortcutsDialog />}
      {dialog?.kind === 'setup' && <SetupWizard />}
      <div className="pointer-events-none fixed right-4 bottom-8 z-[60] flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex max-w-md items-start gap-2 rounded border bg-elev px-3 py-2 text-xs shadow-lg ${
              t.kind === 'error' ? 'border-danger/50' : t.kind === 'success' ? 'border-success/50' : 'border-line'
            }`}
          >
            {t.kind === 'error' ? <CircleX size={14} className="shrink-0 text-danger" /> : t.kind === 'success' ? <CheckCircle2 size={14} className="shrink-0 text-success" /> : <Info size={14} className="shrink-0 text-accent" />}
            <span className="whitespace-pre-wrap">{t.text}</span>
          </div>
        ))}
      </div>
    </>
  );
}
