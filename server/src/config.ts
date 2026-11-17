import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const PORT = Number(process.env.LLD_PORT ?? 4173);
export const HOST = '127.0.0.1';

/** App data (SQLite db, secrets, build output, caches). Never inside the workspace. */
export const DATA_DIR = path.resolve(process.env.LLD_DATA_DIR ?? path.join(os.homedir(), '.lld-studio'));
export const DEFAULT_WORKSPACE_DIR = path.resolve(
  process.env.LLD_WORKSPACE_DIR ?? path.join(os.homedir(), 'LLD-Studio', 'workspace'),
);
export const SECRETS_FILE = path.join(DATA_DIR, '.env');
export const DB_FILE = path.join(DATA_DIR, 'lld-studio.db');
export const BUILD_DIR = path.join(DATA_DIR, 'builds');
export const CACHE_DIR = path.join(DATA_DIR, 'cache');

export const SERVER_ROOT = path.resolve(import.meta.dirname, '..');
export const WEB_DIST = path.resolve(SERVER_ROOT, '..', 'web', 'dist');

export function ensureDirs(workspaceDir: string) {
  for (const d of [DATA_DIR, BUILD_DIR, CACHE_DIR, workspaceDir]) fs.mkdirSync(d, { recursive: true });
}

// ---------------------------------------------------------------------------
// Secrets: API keys live in process env or ~/.lld-studio/.env (chmod 600).
// They are only ever read server-side; the API reports configured/not configured.
// ---------------------------------------------------------------------------

export const SECRET_NAMES = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' } as const;
export type SecretProvider = keyof typeof SECRET_NAMES;

function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function readSecretsFile(): Record<string, string> {
  try {
    return parseEnvFile(fs.readFileSync(SECRETS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function getSecret(provider: SecretProvider): { value?: string; source?: 'env' | 'file' } {
  const name = SECRET_NAMES[provider];
  if (process.env[name]) return { value: process.env[name], source: 'env' };
  const fromFile = readSecretsFile()[name];
  return fromFile ? { value: fromFile, source: 'file' } : {};
}

export function setSecret(provider: SecretProvider, value: string | null) {
  const all = readSecretsFile();
  const name = SECRET_NAMES[provider];
  if (value) all[name] = value.trim();
  else delete all[name];
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const body =
    '# LLD Studio local secrets. Never commit this file.\n' +
    Object.entries(all)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join('\n') +
    '\n';
  fs.writeFileSync(SECRETS_FILE, body, { mode: 0o600 });
  fs.chmodSync(SECRETS_FILE, 0o600);
}

// ---------------------------------------------------------------------------
// JDK detection
// ---------------------------------------------------------------------------

export interface JdkInfo {
  found: boolean;
  javaPath: string;
  javacPath: string;
  version?: string;
  major?: number;
  source: 'settings' | 'JAVA_HOME' | 'PATH';
  error?: string;
}

const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name);

let jdkCache: { key: string; info: JdkInfo } | undefined;

export function detectJdk(configuredHome?: string, force = false): JdkInfo {
  const key = configuredHome ?? '';
  if (!force && jdkCache?.key === key) return jdkCache.info;

  const candidates: { home?: string; source: JdkInfo['source'] }[] = [];
  if (configuredHome) candidates.push({ home: configuredHome, source: 'settings' });
  if (process.env.JAVA_HOME) candidates.push({ home: process.env.JAVA_HOME, source: 'JAVA_HOME' });
  candidates.push({ source: 'PATH' });

  let info: JdkInfo | undefined;
  for (const c of candidates) {
    const javacPath = c.home ? path.join(c.home, 'bin', exe('javac')) : exe('javac');
    const javaPath = c.home ? path.join(c.home, 'bin', exe('java')) : exe('java');
    const r = spawnSync(javacPath, ['-version'], { encoding: 'utf8', timeout: 10_000 });
    if (r.error || r.status !== 0) {
      info ??= {
        found: false,
        javaPath,
        javacPath,
        source: c.source,
        error: r.error ? r.error.message : (r.stderr || r.stdout).trim(),
      };
      continue;
    }
    const out = `${r.stdout}${r.stderr}`.trim();
    const version = out.replace(/^javac\s+/, '');
    const major = Number(version.startsWith('1.') ? version.split('.')[1] : version.split(/[.+-]/)[0]);
    const jr = spawnSync(javaPath, ['-version'], { encoding: 'utf8', timeout: 10_000 });
    if (jr.error || jr.status !== 0) {
      info = { found: false, javaPath, javacPath, source: c.source, version, error: 'javac found but java runtime failed' };
      continue;
    }
    info = { found: true, javaPath, javacPath, version, major, source: c.source };
    break;
  }
  jdkCache = { key, info: info! };
  return info!;
}
