import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeProvider, renderConversation } from '../src/ai/ClaudeCodeProvider.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lld-cc-'));

/** A stand-in for the `claude` CLI that emits the stream-json protocol. */
function fakeCli(behaviour: 'ok' | 'error') {
  const file = path.join(tmp, `claude-${behaviour}`);
  fs.writeFileSync(
    file,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const sys = require('fs').readFileSync(args[args.indexOf('--system-prompt-file') + 1], 'utf8');
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  out({ type: 'system', subtype: 'init', tools: [] });
  if (${JSON.stringify(behaviour)} === 'error') {
    out({ type: 'result', subtype: 'error', is_error: true, result: 'Not logged in. Please run /login' });
    process.exit(1);
  }
  const reply = JSON.stringify({ sys, input, args, apiKey: process.env.ANTHROPIC_API_KEY ?? null });
  for (const part of reply.match(/.{1,20}/gs)) out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: part } } });
  out({ type: 'result', subtype: 'success', is_error: false, result: reply, stop_reason: 'end_turn' });
});
`,
    { mode: 0o755 },
  );
  return file;
}

describe('ClaudeCodeProvider', () => {
  it('streams text deltas, passes the system prompt via file and hides API keys', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-should-not-leak';
    const p = new ClaudeCodeProvider(fakeCli('ok'));
    const deltas: string[] = [];
    const r = await p.stream(
      { system: 'SYSTEM-PROMPT ' + 'x'.repeat(200_000), messages: [{ role: 'user', content: 'hello' }], model: 'sonnet', maxTokens: 100 },
      (d) => deltas.push(d),
    );
    delete process.env.ANTHROPIC_API_KEY;
    const echoed = JSON.parse(r.text);
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join('')).toBe(r.text);
    expect(echoed.sys.startsWith('SYSTEM-PROMPT')).toBe(true); // > 128 KB arrives intact
    expect(echoed.input).toBe('hello');
    expect(echoed.apiKey).toBeNull();
    expect(echoed.args).toEqual(expect.arrayContaining(['-p', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--model', 'sonnet']));
  });

  it('surfaces CLI errors with a sign-in hint', async () => {
    const p = new ClaudeCodeProvider(fakeCli('error'));
    await expect(p.stream({ system: 's', messages: [{ role: 'user', content: 'x' }], model: '', maxTokens: 1 }, () => {})).rejects.toThrow(/Not logged in.*sign in/);
  });

  it('reports a missing CLI clearly', async () => {
    const p = new ClaudeCodeProvider(path.join(tmp, 'does-not-exist'));
    await expect(p.stream({ system: 's', messages: [{ role: 'user', content: 'x' }], model: '', maxTokens: 1 }, () => {})).rejects.toThrow(/Could not start Claude Code/);
  });

  it('renders multi-turn history into one prompt', () => {
    const prompt = renderConversation([
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' },
    ]);
    expect(prompt).toMatch(/<user>\nQ1\n<\/user>\n<assistant>\nA1\n<\/assistant>/);
    expect(prompt.trim().endsWith('Q2')).toBe(true);
  });
});
