import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AIProvider, AIRequest } from '../src/ai/AIProvider.js';

// Isolate data + workspace before the app modules read their config.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lld-ai-'));
process.env.LLD_DATA_DIR = path.join(tmp, 'data');
process.env.LLD_WORKSPACE_DIR = path.join(tmp, 'ws');
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;

const { createServices } = await import('../src/services.js');
const { buildApp } = await import('../src/app.js');

const requests: AIRequest[] = [];
const fake: AIProvider = {
  id: 'anthropic',
  async stream(req, onText) {
    requests.push(req);
    const reply = req.system.includes('role-playing the INTERVIEWER') ? 'Only cars and bikes.' : 'Use the Strategy pattern.';
    for (const part of reply.match(/.{1,6}/g)!) onText(part);
    return { text: reply, stopReason: 'end_turn' };
  },
};

const services = createServices(path.join(tmp, 'test.db'));
const app = await buildApp(services, { logger: false });
const problem = services.problems.list().find((p) => p.slug === 'parking-lot')!;
const headers = { host: '127.0.0.1:4173', 'content-type': 'application/json' };

const chat = (body: object) =>
  app.inject({ method: 'POST', url: '/api/ai/chat', headers, payload: JSON.stringify({ problemId: problem.id, ...body }) });
const events = (payload: string) =>
  payload
    .split('\n\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l.replace(/^data: /, '')));

describe('AI routes', () => {
  it('returns an actionable 400 when no key is configured', async () => {
    const r = await chat({ mode: 'chat', message: 'hi', provider: 'anthropic' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/No API key configured for Anthropic/);
  });

  describe('with a provider', () => {
    beforeAll(() => {
      services.ai.create = () => fake;
    });

    it('streams SSE deltas and persists both messages', async () => {
      const r = await chat({ mode: 'chat', message: 'Which pattern for pricing?', activeFile: 'src/main/java/Main.java', includeActiveFile: true });
      expect(r.headers['content-type']).toMatch(/text\/event-stream/);
      const ev = events(r.payload);
      expect(ev[0]).toMatchObject({ type: 'start', includedFiles: ['src/main/java/Main.java'] });
      expect(ev.filter((e) => e.type === 'delta').map((e) => e.text).join('')).toBe('Use the Strategy pattern.');
      expect(ev.at(-1)).toMatchObject({ type: 'done', message: { role: 'assistant', content: 'Use the Strategy pattern.' } });
      const sys = requests.at(-1)!.system;
      expect(sys).toContain('Parking Lot');
      expect(sys).toContain('public class Main');
      expect(sys).not.toContain("Interviewer's private notes");
      const msgs = services.db.listMessages(problem.id, 'assistant');
      expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    });

    it('sends prior conversation as history on follow-ups', async () => {
      await chat({ mode: 'chat', message: 'And for payments?' });
      const msgs = requests.at(-1)!.messages;
      expect(msgs.map((m) => m.content)).toEqual(['Which pattern for pricing?', 'Use the Strategy pattern.', 'And for payments?']);
    });

    it('interviewer mode uses hidden notes and its own thread', async () => {
      const r = await chat({ mode: 'interviewer_answer', message: 'Which vehicle types?' });
      expect(events(r.payload).at(-1).type).toBe('done');
      const req = requests.at(-1)!;
      expect(req.system).toContain("Interviewer's private notes");
      expect(req.system).toContain('NEVER reveal');
      expect(req.messages).toHaveLength(1);
      expect(services.db.listMessages(problem.id, 'interviewer')).toHaveLength(2);
    });

    it('pseudo_to_java includes the pseudocode and the file-block output contract', async () => {
      await chat({ mode: 'pseudo_to_java', pseudoFile: 'pseudocode/solution.pseudo' });
      const req = requests.at(-1)!;
      expect(req.system).toContain('### Pseudocode: pseudocode/solution.pseudo');
      expect(req.system).toContain('=== FILE: src/main/java/');
      expect(req.messages[0].content).toBe('Convert my pseudocode into Java.');
    });

    it('debug_error includes the last run output', async () => {
      await chat({ mode: 'debug_error', runOutput: 'Exception in thread "main" java.lang.NullPointerException' });
      expect(requests.at(-1)!.system).toContain('NullPointerException');
    });

    it('rejects unknown modes', async () => {
      expect((await chat({ mode: 'hack', message: 'x' })).statusCode).toBe(400);
    });
  });
});

describe('request origin guard', () => {
  it('blocks foreign hosts and origins', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/problems', headers: { host: 'evil.example' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/problems', headers: { host: 'localhost:4173', origin: 'https://evil.example' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/problems', headers: { host: 'localhost:4173', origin: 'http://localhost:5173' } })).statusCode).toBe(200);
  });
});

describe('secrets', () => {
  it('stores keys with 0600 and never returns them', async () => {
    const put = await app.inject({ method: 'PUT', url: '/api/secrets/openai', headers, payload: JSON.stringify({ apiKey: 'sk-test-1234567890' }) });
    expect(put.statusCode).toBe(200);
    const status = await app.inject({ method: 'GET', url: '/api/secrets/status', headers });
    expect(status.json().openai).toMatchObject({ configured: true, source: 'file' });
    expect(status.payload).not.toContain('sk-test');
    const file = path.join(process.env.LLD_DATA_DIR!, '.env');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
});
