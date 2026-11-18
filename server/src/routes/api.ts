import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ZipArchive, type EntryData } from 'archiver';
import type { FastifyInstance } from 'fastify';
import type { Services, Settings } from '../services.js';
import { DATA_DIR, SECRETS_FILE, SECRET_NAMES, getSecret, setSecret, type SecretProvider } from '../config.js';
import { JAVA_SRC } from '../projects/ProjectManager.js';
import { extractProjectSymbols } from '../completion/ProjectSymbols.js';
import { CLARIFICATION_CATEGORIES } from '../ai/prompts.js';
import { PROVIDER_IDS } from '../ai/AIProviderFactory.js';
import { claudeCodeStatus } from '../ai/ClaudeCodeProvider.js';
import { buildAttemptMarkdown } from '../problems/AttemptExport.js';

type Body = Record<string, any>;
const str = (v: unknown, name: string) => {
  if (typeof v !== 'string') throw Object.assign(new Error(`"${name}" must be a string`), { statusCode: 400 });
  return v;
};

const SETTINGS_KEYS = Object.keys({
  aiProvider: 1, anthropicModel: 1, openaiModel: 1, claudeCodeModel: 1, claudeCodePath: 1, maxTokens: 1, theme: 1, autocomplete: 1, liveErrors: 1,
  runTimeoutSec: 1, maxHeapMb: 1, jdkPath: 1, workspaceDir: 1, fontSize: 1, setupComplete: 1,
} satisfies Record<keyof Settings, 1>);

export function registerApiRoutes(app: FastifyInstance, s: Services) {
  const problemFiles = (id: string) => {
    const p = s.problems.get(id);
    return { problem: p, files: s.projects.fs(p.slug) };
  };

  // --- system / settings -----------------------------------------------------
  app.get('/api/system', async (req) => {
    const q = req.query as { refresh?: string };
    const jdk = s.jdk(q.refresh === '1');
    return {
      jdk,
      workspaceDir: s.workspaceDir,
      dataDir: DATA_DIR,
      platform: `${os.platform()} ${os.release()}`,
      node: process.version,
      firstRun: !s.getSettings().setupComplete,
      secretsFile: SECRETS_FILE,
    };
  });

  app.get('/api/settings', async () => s.getSettings());
  app.put('/api/settings', async (req) => {
    const body = req.body as Body;
    const patch = Object.fromEntries(Object.entries(body).filter(([k]) => SETTINGS_KEYS.includes(k))) as Partial<Settings>;
    if (patch.aiProvider && !PROVIDER_IDS.includes(patch.aiProvider)) throw Object.assign(new Error('Invalid provider'), { statusCode: 400 });
    if (patch.runTimeoutSec !== undefined) patch.runTimeoutSec = Math.min(Math.max(Number(patch.runTimeoutSec) || 60, 1), 3600);
    if (patch.maxHeapMb !== undefined) patch.maxHeapMb = Math.min(Math.max(Number(patch.maxHeapMb) || 512, 32), 8192);
    if (patch.maxTokens !== undefined) patch.maxTokens = Math.min(Math.max(Number(patch.maxTokens) || 16000, 256), 128000);
    const next = s.saveSettings(patch);
    if (patch.jdkPath !== undefined) s.jdk(true);
    return next;
  });

  // Small key/value store for UI state (layout, open tabs per problem, last problem).
  app.get('/api/state/:key', async (req) => {
    const { key } = req.params as { key: string };
    return { value: s.db.getSetting(`ui:${key}`, null) };
  });
  app.put('/api/state/:key', async (req) => {
    const { key } = req.params as { key: string };
    s.db.setSetting(`ui:${key}`, (req.body as Body).value ?? null);
    return { ok: true };
  });

  app.get('/api/claude-code/status', async () => claudeCodeStatus(s.getSettings().claudeCodePath || 'claude'));

  // --- secrets (write-only from the browser's perspective) --------------------
  app.get('/api/secrets/status', async () => {
    const out: Record<string, { configured: boolean; source?: string; envVar: string }> = {};
    for (const p of Object.keys(SECRET_NAMES) as SecretProvider[]) {
      const sec = getSecret(p);
      out[p] = { configured: !!sec.value, source: sec.source, envVar: SECRET_NAMES[p] };
    }
    return out;
  });
  app.put('/api/secrets/:provider', async (req) => {
    const { provider } = req.params as { provider: SecretProvider };
    if (!(provider in SECRET_NAMES)) throw Object.assign(new Error('Unknown provider'), { statusCode: 400 });
    const key = str((req.body as Body).apiKey, 'apiKey').trim();
    if (key.length < 10) throw Object.assign(new Error('That does not look like an API key'), { statusCode: 400 });
    setSecret(provider, key);
    return { ok: true };
  });
  app.delete('/api/secrets/:provider', async (req) => {
    const { provider } = req.params as { provider: SecretProvider };
    if (!(provider in SECRET_NAMES)) throw Object.assign(new Error('Unknown provider'), { statusCode: 400 });
    setSecret(provider, null);
    return { ok: true };
  });

  // --- problems --------------------------------------------------------------
  app.get('/api/problems', async () => s.problems.list().map(({ interviewer_notes, ...p }) => ({ ...p, has_interviewer_notes: !!interviewer_notes.trim() })));
  app.post('/api/problems', async (req) => s.problems.create(req.body as any));
  app.post('/api/problems/import', async (req) => {
    const b = req.body as Body;
    const src = str(b.path, 'path').replace(/^~(?=$|[\\/])/, os.homedir());
    return s.problems.importFromDirectory(src, b.title?.trim() || path.basename(path.resolve(src)));
  });
  app.get('/api/problems/:id', async (req) => {
    const { id } = req.params as { id: string };
    const p = s.problems.get(id);
    return { ...p, projectDir: s.projects.projectDir(p.slug) };
  });
  app.put('/api/problems/:id', async (req) => {
    const { id } = req.params as { id: string };
    const b = req.body as Body;
    return s.problems.update(id, {
      title: b.title, description: b.description, functional_reqs: b.functional_reqs,
      non_functional_reqs: b.non_functional_reqs, interviewer_notes: b.interviewer_notes,
    });
  });
  app.delete('/api/problems/:id', async (req) => {
    const { id } = req.params as { id: string };
    s.problems.delete(id, (req.query as Body).deleteFiles === '1');
    return { ok: true };
  });

  // --- files -----------------------------------------------------------------
  app.get('/api/problems/:id/tree', async (req) => problemFiles((req.params as Body).id).files.tree());
  app.get('/api/problems/:id/file', async (req) => {
    const { files } = problemFiles((req.params as Body).id);
    const rel = str((req.query as Body).path, 'path');
    return { path: rel, content: files.read(rel) };
  });
  app.put('/api/problems/:id/file', async (req) => {
    const { files } = problemFiles((req.params as Body).id);
    const b = req.body as Body;
    files.write(str(b.path, 'path'), str(b.content, 'content'));
    return { ok: true, savedAt: Date.now() };
  });
  app.post('/api/problems/:id/fs/create', async (req) => {
    const { files } = problemFiles((req.params as Body).id);
    const b = req.body as Body;
    const rel = str(b.path, 'path');
    let content = typeof b.content === 'string' ? b.content : '';
    if (!content && rel.endsWith('.java')) content = javaTemplate(rel, b.kind);
    files.createFile(rel, content);
    return { ok: true, path: rel };
  });
  app.post('/api/problems/:id/fs/mkdir', async (req) => {
    const { files } = problemFiles((req.params as Body).id);
    files.mkdir(str((req.body as Body).path, 'path'));
    return { ok: true };
  });
  app.post('/api/problems/:id/fs/package', async (req) => {
    const { files } = problemFiles((req.params as Body).id);
    const pkg = str((req.body as Body).name, 'name').trim();
    if (!/^[a-zA-Z_$][\w$]*(\.[a-zA-Z_$][\w$]*)*$/.test(pkg)) throw Object.assign(new Error(`Invalid package name: ${pkg}`), { statusCode: 400 });
    const rel = `${JAVA_SRC}/${pkg.replace(/\./g, '/')}`;
    files.mkdir(rel);
    return { ok: true, path: rel };
  });
  app.post('/api/problems/:id/fs/move', async (req) => {
    const { files } = problemFiles((req.params as Body).id);
    const b = req.body as Body;
    files.move(str(b.from, 'from'), str(b.to, 'to'));
    return { ok: true };
  });
  app.delete('/api/problems/:id/fs', async (req) => {
    const { files } = problemFiles((req.params as Body).id);
    files.delete(str((req.query as Body).path, 'path'));
    return { ok: true };
  });
  app.post('/api/problems/:id/fs/upload', { bodyLimit: 100 * 1024 * 1024 }, async (req) => {
    const { files } = problemFiles((req.params as Body).id);
    const list = (req.body as Body).files as { path: string; contentBase64: string }[];
    if (!Array.isArray(list)) throw Object.assign(new Error('"files" must be an array'), { statusCode: 400 });
    // Validate every path before writing anything, so a bad entry can't leave a partial import.
    for (const f of list) files.resolve(str(f.path, 'path'));
    const skipped: string[] = [];
    for (const f of list) {
      const rel = str(f.path, 'path');
      if (/(^|\/)(node_modules|\.git|target|build|out)(\/|$)/.test(rel)) {
        skipped.push(rel);
        continue;
      }
      files.writeBuffer(rel, Buffer.from(str(f.contentBase64, 'contentBase64'), 'base64'));
    }
    return { ok: true, written: list.length - skipped.length, skipped };
  });
  /** The whole attempt as one Markdown document, for rating in an external chatbot. ?download=1 saves it as a file. */
  app.get('/api/problems/:id/export.md', async (req, reply) => {
    const { problem, files } = problemFiles((req.params as Body).id);
    const md = buildAttemptMarkdown(problem, s.db.listClarifications(problem.id), s.db.listMessages(problem.id, 'interviewer'), files);
    reply.header('Content-Type', 'text/markdown; charset=utf-8');
    if ((req.query as Body).download === '1') reply.header('Content-Disposition', `attachment; filename="${problem.slug}-attempt.md"`);
    return reply.send(md);
  });
  app.get('/api/problems/:id/export', async (req, reply) => {
    const { problem, files } = problemFiles((req.params as Body).id);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.directory(files.root, problem.slug, (entry: EntryData) => (/(^|\/)(node_modules|\.git)(\/|$)/.test(entry.name) ? false : entry));
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${problem.slug}.zip"`);
    void archive.finalize();
    return reply.send(archive);
  });

  // --- java ------------------------------------------------------------------
  app.get('/api/problems/:id/main-classes', async (req) => s.compiler.findMainClasses(problemFiles((req.params as Body).id).files));
  app.post('/api/problems/:id/check', async (req) => {
    const { problem, files } = problemFiles((req.params as Body).id);
    const jdk = s.jdk();
    if (!jdk.found) throw Object.assign(new Error('JDK not found'), { statusCode: 412 });
    const r = await s.compiler.compile(jdk, files, `${problem.slug}-check`);
    return { success: r.success, diagnostics: r.diagnostics, durationMs: r.durationMs };
  });
  app.get('/api/problems/:id/symbols', async (req) => {
    const { files } = problemFiles((req.params as Body).id);
    const javaFiles = files.listFiles((p) => p.endsWith('.java')).map((p) => ({ path: p, content: files.read(p) }));
    return extractProjectSymbols(javaFiles);
  });
  app.get('/api/completion/index', async (req, reply) => {
    const jdk = s.jdk();
    if (!jdk.found) return reply.code(412).send({ error: 'JDK not found' });
    const file = await s.apiIndex.ensure(jdk);
    reply.header('Content-Type', 'application/json').header('Cache-Control', 'max-age=86400');
    return reply.send(fs.createReadStream(file));
  });

  // --- clarifications --------------------------------------------------------
  app.get('/api/clarification-categories', async () => CLARIFICATION_CATEGORIES);
  app.get('/api/problems/:id/clarifications', async (req) => {
    const { problem } = problemFiles((req.params as Body).id);
    return s.db.listClarifications(problem.id);
  });
  app.post('/api/problems/:id/clarifications', async (req) => {
    const { problem } = problemFiles((req.params as Body).id);
    const b = req.body as Body;
    return s.db.insertClarification(problem.id, {
      category: str(b.category ?? CLARIFICATION_CATEGORIES[0], 'category'),
      question: str(b.question, 'question'),
      response: typeof b.response === 'string' ? b.response : '',
      source: b.source === 'ai' ? 'ai' : 'user',
    });
  });
  app.put('/api/clarifications/:cid', async (req, reply) => {
    const b = req.body as Body;
    const row = s.db.updateClarification((req.params as Body).cid, { category: b.category, question: b.question, response: b.response });
    return row ?? reply.code(404).send({ error: 'Not found' });
  });
  app.delete('/api/clarifications/:cid', async (req) => {
    s.db.deleteClarification((req.params as Body).cid);
    return { ok: true };
  });

  // --- chat history ----------------------------------------------------------
  app.get('/api/problems/:id/threads/:thread', async (req) => {
    const { id, thread } = req.params as Body;
    s.problems.get(id);
    return s.db.listMessages(id, thread);
  });
  app.delete('/api/problems/:id/threads/:thread', async (req) => {
    const { id, thread } = req.params as Body;
    s.db.clearThread(id, thread);
    return { ok: true };
  });
}

function javaTemplate(rel: string, kind: string = 'class') {
  const name = path.posix.basename(rel, '.java');
  const idx = rel.indexOf(`${JAVA_SRC}/`);
  const dir = idx >= 0 ? path.posix.dirname(rel.slice(idx + JAVA_SRC.length + 1)) : '.';
  const pkg = dir && dir !== '.' ? `package ${dir.replace(/\//g, '.')};\n\n` : '';
  const k = ['class', 'interface', 'enum', 'record', 'abstract class'].includes(kind) ? kind : 'class';
  const body = k === 'record' ? `public record ${name}() {\n}\n` : `public ${k} ${name} {\n\n}\n`;
  return pkg + body;
}
