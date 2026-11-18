export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: TreeNode[];
}

export interface Problem {
  id: string;
  slug: string;
  title: string;
  description: string;
  functional_reqs: string;
  non_functional_reqs: string;
  interviewer_notes?: string;
  has_interviewer_notes?: boolean;
  sample: number;
  created_at: string;
  updated_at: string;
  projectDir?: string;
}

export interface Clarification {
  id: string;
  problem_id: string;
  category: string;
  question: string;
  response: string;
  status: 'unanswered' | 'answered';
  source: 'user' | 'ai';
  created_at: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  mode: string;
  created_at: string;
}

export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
  message: string;
}

export interface JdkInfo {
  found: boolean;
  javaPath: string;
  javacPath: string;
  version?: string;
  major?: number;
  source: string;
  error?: string;
}

export interface SystemInfo {
  jdk: JdkInfo;
  workspaceDir: string;
  dataDir: string;
  platform: string;
  node: string;
  firstRun: boolean;
  secretsFile: string;
}

export type ProviderId = 'anthropic' | 'openai' | 'claude-code';

export interface ClaudeCodeStatus {
  found: boolean;
  version?: string;
  loggedIn?: boolean;
  authMethod?: string;
  error?: string;
}

export interface Settings {
  aiProvider: ProviderId;
  anthropicModel: string;
  openaiModel: string;
  claudeCodeModel: string;
  claudeCodePath: string;
  maxTokens: number;
  theme: 'dark' | 'light';
  autocomplete: boolean;
  liveErrors: boolean;
  runTimeoutSec: number;
  maxHeapMb: number;
  jdkPath: string;
  workspaceDir: string;
  fontSize: number;
  setupComplete: boolean;
}

export type SecretsStatus = Record<'anthropic' | 'openai', { configured: boolean; source?: string; envVar: string }>;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(data?.error ?? `${res.status} ${res.statusText}`, res.status);
  return data as T;
}

const q = encodeURIComponent;

export const api = {
  system: (refresh = false) => request<SystemInfo>('GET', `/api/system${refresh ? '?refresh=1' : ''}`),
  settings: () => request<Settings>('GET', '/api/settings'),
  saveSettings: (patch: Partial<Settings>) => request<Settings>('PUT', '/api/settings', patch),
  getState: <T>(key: string) => request<{ value: T | null }>('GET', `/api/state/${q(key)}`).then((r) => r.value),
  setState: (key: string, value: unknown) => request('PUT', `/api/state/${q(key)}`, { value }),
  secrets: () => request<SecretsStatus>('GET', '/api/secrets/status'),
  claudeCodeStatus: () => request<ClaudeCodeStatus>('GET', '/api/claude-code/status'),
  setSecret: (provider: string, apiKey: string) => request('PUT', `/api/secrets/${provider}`, { apiKey }),
  deleteSecret: (provider: string) => request('DELETE', `/api/secrets/${provider}`),

  problems: () => request<Problem[]>('GET', '/api/problems'),
  problem: (id: string) => request<Problem>('GET', `/api/problems/${id}`),
  createProblem: (p: Partial<Problem>) => request<Problem>('POST', '/api/problems', p),
  importProblem: (path: string, title?: string) => request<Problem>('POST', '/api/problems/import', { path, title }),
  updateProblem: (id: string, p: Partial<Problem>) => request<Problem>('PUT', `/api/problems/${id}`, p),
  deleteProblem: (id: string, deleteFiles: boolean) => request('DELETE', `/api/problems/${id}${deleteFiles ? '?deleteFiles=1' : ''}`),

  tree: (id: string) => request<TreeNode>('GET', `/api/problems/${id}/tree`),
  readFile: (id: string, path: string) => request<{ content: string }>('GET', `/api/problems/${id}/file?path=${q(path)}`).then((r) => r.content),
  writeFile: (id: string, path: string, content: string) => request('PUT', `/api/problems/${id}/file`, { path, content }),
  createFile: (id: string, path: string, content?: string, kind?: string) => request('POST', `/api/problems/${id}/fs/create`, { path, content, kind }),
  mkdir: (id: string, path: string) => request('POST', `/api/problems/${id}/fs/mkdir`, { path }),
  createPackage: (id: string, name: string) => request<{ path: string }>('POST', `/api/problems/${id}/fs/package`, { name }),
  move: (id: string, from: string, to: string) => request('POST', `/api/problems/${id}/fs/move`, { from, to }),
  remove: (id: string, path: string) => request('DELETE', `/api/problems/${id}/fs?path=${q(path)}`),
  upload: (id: string, files: { path: string; contentBase64: string }[]) =>
    request<{ written: number; skipped: string[] }>('POST', `/api/problems/${id}/fs/upload`, { files }),
  exportUrl: (id: string) => `/api/problems/${id}/export`,
  attemptUrl: (id: string) => `/api/problems/${id}/export.md?download=1`,
  attemptMarkdown: async (id: string) => {
    const res = await fetch(`/api/problems/${id}/export.md`);
    if (!res.ok) throw new ApiError(`Export failed (${res.status})`, res.status);
    return res.text();
  },

  mainClasses: (id: string) => request<{ className: string; file: string }[]>('GET', `/api/problems/${id}/main-classes`),
  check: (id: string) => request<{ success: boolean; diagnostics: Diagnostic[] }>('POST', `/api/problems/${id}/check`, {}),
  symbols: (id: string) => request<any[]>('GET', `/api/problems/${id}/symbols`),
  completionIndex: () => request<any[]>('GET', '/api/completion/index'),

  categories: () => request<string[]>('GET', '/api/clarification-categories'),
  clarifications: (id: string) => request<Clarification[]>('GET', `/api/problems/${id}/clarifications`),
  addClarification: (id: string, c: Partial<Clarification>) => request<Clarification>('POST', `/api/problems/${id}/clarifications`, c),
  updateClarification: (cid: string, c: Partial<Clarification>) => request<Clarification>('PUT', `/api/clarifications/${cid}`, c),
  deleteClarification: (cid: string) => request('DELETE', `/api/clarifications/${cid}`),

  thread: (id: string, thread: string) => request<ChatMessage[]>('GET', `/api/problems/${id}/threads/${thread}`),
  clearThread: (id: string, thread: string) => request('DELETE', `/api/problems/${id}/threads/${thread}`),
};

export interface AiChatRequest {
  problemId: string;
  mode: string;
  message?: string;
  provider?: string;
  activeFile?: string;
  includeActiveFile?: boolean;
  includeProject?: boolean;
  attachedFiles?: string[];
  pseudoFile?: string;
  runOutput?: string;
}

export interface AiStreamHandlers {
  onStart?(e: { userMessage: ChatMessage; provider: string; model: string; includedFiles: string[]; truncated: string[] }): void;
  onDelta(text: string): void;
  onDone?(message: ChatMessage): void;
}

/** POST + read the SSE stream. Resolves with the full text; rejects with an Error on failure. */
export async function streamAi(req: AiChatRequest, handlers: AiStreamHandlers, signal?: AbortSignal): Promise<string> {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error ?? `AI request failed (${res.status})`, res.status);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  let full = '';
  let error: string | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (!chunk.startsWith('data: ')) continue;
      const ev = JSON.parse(chunk.slice(6));
      if (ev.type === 'start') handlers.onStart?.(ev);
      else if (ev.type === 'delta') {
        full += ev.text;
        handlers.onDelta(ev.text);
      } else if (ev.type === 'done') handlers.onDone?.(ev.message);
      else if (ev.type === 'error') error = ev.message;
    }
  }
  if (error) throw new ApiError(error, 502);
  return full;
}

export const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
