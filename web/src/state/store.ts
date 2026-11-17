import { create } from 'zustand';
import { api, type Diagnostic, type Problem, type SecretsStatus, type Settings, type SystemInfo, type TreeNode } from '../api/client';

export type BottomTab = 'clarify' | 'design' | 'notes' | 'terminal' | 'problems';
export type CenterMode = 'code' | 'pseudo' | 'problem';

export interface Layout {
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
  leftOpen: boolean;
  rightOpen: boolean;
  bottomOpen: boolean;
  bottomTab: BottomTab;
  centerMode: CenterMode;
}

export const DEFAULT_LAYOUT: Layout = {
  leftWidth: 270,
  rightWidth: 380,
  bottomHeight: 260,
  leftOpen: true,
  rightOpen: true,
  bottomOpen: true,
  bottomTab: 'terminal',
  centerMode: 'code',
};

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

export type RunPhase = 'idle' | 'compiling' | 'running';

interface State {
  system: SystemInfo | null;
  settings: Settings | null;
  secrets: SecretsStatus | null;
  problems: Problem[];
  problem: Problem | null;
  tree: TreeNode | null;
  openTabs: string[];
  activeTab: string | null;
  activePseudo: string | null;
  dirty: Record<string, boolean>;
  diagnostics: Diagnostic[];
  layout: Layout;
  runPhase: RunPhase;
  /** Plain-text transcript of the most recent compile/run, for "debug this error". */
  lastRunOutput: string;
  toasts: Toast[];
  dialog: null | { kind: 'settings' | 'problems' | 'shortcuts' | 'setup' };
  /** Bumped to ask the AI panel to send something (from other panels). */
  aiRequest: null | { id: number; mode: string; message?: string; extra?: Record<string, unknown> };
  /** Files explicitly attached to the next AI messages. */
  aiAttachments: string[];

  set: (p: Partial<State>) => void;
  setLayout: (p: Partial<Layout>) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  refreshTree: () => Promise<void>;
  refreshProblems: () => Promise<void>;
  updateSettings: (p: Partial<Settings>) => Promise<void>;
  requestAi: (mode: string, message?: string, extra?: Record<string, unknown>) => void;
}

let toastId = 0;
let layoutTimer: number | undefined;
let reqId = 0;

export const useStore = create<State>((set, get) => ({
  system: null,
  settings: null,
  secrets: null,
  problems: [],
  problem: null,
  tree: null,
  openTabs: [],
  activeTab: null,
  activePseudo: null,
  dirty: {},
  diagnostics: [],
  layout: loadCachedLayout(),
  runPhase: 'idle',
  lastRunOutput: '',
  toasts: [],
  dialog: null,
  aiRequest: null,
  aiAttachments: [],

  set: (p) => set(p),
  setLayout: (p) => {
    const layout = { ...get().layout, ...p };
    set({ layout });
    try {
      localStorage.setItem('lld:layout', JSON.stringify(layout));
    } catch {
      /* storage unavailable */
    }
    clearTimeout(layoutTimer);
    layoutTimer = window.setTimeout(() => api.setState('layout', layout).catch(() => {}), 500);
  },
  toast: (text, kind = 'info') => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), kind === 'error' ? 7000 : 3500);
  },
  refreshTree: async () => {
    const p = get().problem;
    if (!p) return;
    const tree = await api.tree(p.id);
    if (get().problem?.id === p.id) set({ tree });
  },
  refreshProblems: async () => set({ problems: await api.problems() }),
  updateSettings: async (patch) => {
    set({ settings: { ...get().settings!, ...patch } });
    try {
      set({ settings: await api.saveSettings(patch) });
    } catch (e) {
      get().toast(`Could not save settings: ${(e as Error).message}`, 'error');
    }
  },
  requestAi: (mode, message, extra) => {
    const { layout, setLayout } = get();
    if (!layout.rightOpen) setLayout({ rightOpen: true });
    set({ aiRequest: { id: ++reqId, mode, message, extra } });
  },
}));

function loadCachedLayout(): Layout {
  try {
    return { ...DEFAULT_LAYOUT, ...JSON.parse(localStorage.getItem('lld:layout') ?? '{}') };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export const allFiles = (tree: TreeNode | null): string[] => {
  const out: string[] = [];
  const walk = (n: TreeNode) => {
    if (n.type === 'file') out.push(n.path);
    n.children?.forEach(walk);
  };
  if (tree) walk(tree);
  return out;
};

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
