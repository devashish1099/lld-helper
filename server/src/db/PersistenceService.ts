import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export interface ProblemRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  functional_reqs: string;
  non_functional_reqs: string;
  interviewer_notes: string;
  sample: number;
  created_at: string;
  updated_at: string;
}

export interface ClarificationRow {
  id: string;
  problem_id: string;
  category: string;
  question: string;
  response: string;
  status: 'unanswered' | 'answered';
  source: 'user' | 'ai';
  sort: number;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRow {
  id: string;
  problem_id: string;
  thread: string;
  role: 'user' | 'assistant';
  content: string;
  mode: string;
  created_at: string;
}

const MIGRATIONS: string[] = [
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE problems (
     id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '', functional_reqs TEXT NOT NULL DEFAULT '',
     non_functional_reqs TEXT NOT NULL DEFAULT '', interviewer_notes TEXT NOT NULL DEFAULT '',
     sample INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE clarifications (
     id TEXT PRIMARY KEY, problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
     category TEXT NOT NULL, question TEXT NOT NULL, response TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT 'unanswered', source TEXT NOT NULL DEFAULT 'user',
     sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE INDEX idx_clar_problem ON clarifications(problem_id);
   CREATE TABLE chat_messages (
     id TEXT PRIMARY KEY, problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
     thread TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'chat',
     created_at TEXT NOT NULL);
   CREATE INDEX idx_chat_thread ON chat_messages(problem_id, thread, created_at);`,
];

const now = () => new Date().toISOString();

export class PersistenceService {
  readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate() {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
    const row = this.db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
    let version = row?.version ?? 0;
    if (!row) this.db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
    while (version < MIGRATIONS.length) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(MIGRATIONS[version]);
        version++;
        this.db.prepare('UPDATE schema_version SET version = ?').run(version);
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    }
  }

  // --- settings ------------------------------------------------------------
  getSetting<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : fallback;
  }

  setSetting(key: string, value: unknown) {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  // --- problems ------------------------------------------------------------
  listProblems(): ProblemRow[] {
    return this.db.prepare('SELECT * FROM problems ORDER BY sample ASC, created_at ASC').all() as unknown as ProblemRow[];
  }

  getProblem(id: string): ProblemRow | undefined {
    return this.db.prepare('SELECT * FROM problems WHERE id = ?').get(id) as unknown as ProblemRow | undefined;
  }

  getProblemBySlug(slug: string): ProblemRow | undefined {
    return this.db.prepare('SELECT * FROM problems WHERE slug = ?').get(slug) as unknown as ProblemRow | undefined;
  }

  insertProblem(p: Omit<ProblemRow, 'id' | 'created_at' | 'updated_at'>): ProblemRow {
    const id = randomUUID();
    const t = now();
    this.db
      .prepare(
        `INSERT INTO problems (id, slug, title, description, functional_reqs, non_functional_reqs, interviewer_notes, sample, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, p.slug, p.title, p.description, p.functional_reqs, p.non_functional_reqs, p.interviewer_notes, p.sample, t, t);
    return this.getProblem(id)!;
  }

  updateProblem(id: string, patch: Partial<Pick<ProblemRow, 'title' | 'description' | 'functional_reqs' | 'non_functional_reqs' | 'interviewer_notes'>>) {
    const fields = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (!fields.length) return this.getProblem(id);
    const sql = `UPDATE problems SET ${fields.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`;
    this.db.prepare(sql).run(...fields.map(([, v]) => v as string), now(), id);
    return this.getProblem(id);
  }

  /** Update a sample's built-in content without marking it as user-edited (updated_at stays = created_at). */
  refreshSample(id: string, p: Pick<ProblemRow, 'title' | 'description' | 'functional_reqs' | 'non_functional_reqs' | 'interviewer_notes'>) {
    this.db
      .prepare('UPDATE problems SET title = ?, description = ?, functional_reqs = ?, non_functional_reqs = ?, interviewer_notes = ? WHERE id = ? AND sample = 1 AND updated_at = created_at')
      .run(p.title, p.description, p.functional_reqs, p.non_functional_reqs, p.interviewer_notes, id);
  }

  deleteProblem(id: string) {
    this.db.prepare('DELETE FROM problems WHERE id = ?').run(id);
  }

  // --- clarifications ------------------------------------------------------
  listClarifications(problemId: string): ClarificationRow[] {
    return this.db
      .prepare('SELECT * FROM clarifications WHERE problem_id = ? ORDER BY sort ASC, created_at ASC')
      .all(problemId) as unknown as ClarificationRow[];
  }

  insertClarification(problemId: string, c: Partial<ClarificationRow> & { question: string; category: string }): ClarificationRow {
    const id = randomUUID();
    const t = now();
    const maxSort = (this.db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM clarifications WHERE problem_id = ?').get(problemId) as { m: number }).m;
    const response = c.response ?? '';
    this.db
      .prepare(
        `INSERT INTO clarifications (id, problem_id, category, question, response, status, source, sort, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, problemId, c.category, c.question, response, response.trim() ? 'answered' : 'unanswered', c.source ?? 'user', maxSort + 1, t, t);
    return this.db.prepare('SELECT * FROM clarifications WHERE id = ?').get(id) as unknown as ClarificationRow;
  }

  updateClarification(id: string, patch: Partial<Pick<ClarificationRow, 'category' | 'question' | 'response'>>) {
    const cur = this.db.prepare('SELECT * FROM clarifications WHERE id = ?').get(id) as unknown as ClarificationRow | undefined;
    if (!cur) return undefined;
    const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    next.status = next.response.trim() ? 'answered' : 'unanswered';
    this.db
      .prepare('UPDATE clarifications SET category = ?, question = ?, response = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(next.category, next.question, next.response, next.status, now(), id);
    return this.db.prepare('SELECT * FROM clarifications WHERE id = ?').get(id) as unknown as ClarificationRow;
  }

  deleteClarification(id: string) {
    this.db.prepare('DELETE FROM clarifications WHERE id = ?').run(id);
  }

  // --- chat ----------------------------------------------------------------
  listMessages(problemId: string, thread: string, limit = 500): ChatMessageRow[] {
    return (
      this.db
        .prepare('SELECT * FROM chat_messages WHERE problem_id = ? AND thread = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
        .all(problemId, thread, limit) as unknown as ChatMessageRow[]
    ).reverse();
  }

  insertMessage(m: Omit<ChatMessageRow, 'id' | 'created_at'>): ChatMessageRow {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO chat_messages (id, problem_id, thread, role, content, mode, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, m.problem_id, m.thread, m.role, m.content, m.mode, now());
    return this.db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id) as unknown as ChatMessageRow;
  }

  clearThread(problemId: string, thread: string) {
    this.db.prepare('DELETE FROM chat_messages WHERE problem_id = ? AND thread = ?').run(problemId, thread);
  }
}
