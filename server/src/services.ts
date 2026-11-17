import fs from 'node:fs';
import path from 'node:path';
import { BUILD_DIR, DATA_DIR, DB_FILE, DEFAULT_WORKSPACE_DIR, detectJdk, ensureDirs } from './config.js';
import { PersistenceService } from './db/PersistenceService.js';
import { ProjectManager } from './projects/ProjectManager.js';
import { ProblemManager } from './problems/ProblemManager.js';
import { CompilationService } from './java/CompilationService.js';
import { ApiIndex } from './java/ApiIndex.js';
import { AIProviderFactory, DEFAULT_MODELS, type ProviderId } from './ai/AIProviderFactory.js';
import { ContextManager } from './ai/ContextManager.js';

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

export const DEFAULT_SETTINGS: Settings = {
  aiProvider: 'claude-code',
  anthropicModel: DEFAULT_MODELS.anthropic,
  openaiModel: DEFAULT_MODELS.openai,
  claudeCodeModel: DEFAULT_MODELS['claude-code'],
  claudeCodePath: 'claude',
  maxTokens: 16000,
  theme: 'dark',
  autocomplete: true,
  liveErrors: true,
  runTimeoutSec: 60,
  maxHeapMb: 512,
  jdkPath: '',
  workspaceDir: DEFAULT_WORKSPACE_DIR,
  fontSize: 14,
  setupComplete: false,
};

export function createServices(dbFile = DB_FILE) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new PersistenceService(dbFile);
  const getSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...db.getSetting<Partial<Settings>>('settings', {}) });
  // The workspace directory is fixed for the lifetime of the process (changes apply on restart).
  const workspaceDir = path.resolve(process.env.LLD_WORKSPACE_DIR ?? getSettings().workspaceDir);
  ensureDirs(workspaceDir);
  const projects = new ProjectManager(workspaceDir);
  const problems = new ProblemManager(db, projects);
  problems.seedSamples();
  return {
    db,
    projects,
    problems,
    workspaceDir,
    compiler: new CompilationService(BUILD_DIR),
    apiIndex: new ApiIndex(),
    ai: new AIProviderFactory(),
    context: new ContextManager(),
    getSettings,
    saveSettings(patch: Partial<Settings>) {
      const next = { ...getSettings(), ...patch };
      db.setSetting('settings', next);
      return next;
    },
    jdk: (force = false) => detectJdk(getSettings().jdkPath || undefined, force),
  };
}

export type Services = ReturnType<typeof createServices>;
