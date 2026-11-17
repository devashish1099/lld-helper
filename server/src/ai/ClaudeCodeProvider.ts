import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CACHE_DIR } from '../config.js';
import type { AIMessage, AIProvider, AIRequest, AIResult } from './AIProvider.js';

const run = promisify(execFile);

export interface ClaudeCodeStatus {
  found: boolean;
  version?: string;
  loggedIn?: boolean;
  authMethod?: string;
  error?: string;
}

/** Detect the Claude Code CLI and whether it is signed in. */
export async function claudeCodeStatus(cliPath: string): Promise<ClaudeCodeStatus> {
  try {
    const { stdout } = await run(cliPath, ['--version'], { timeout: 15_000 });
    const version = stdout.trim().split(/\s+/)[0];
    try {
      const { stdout: auth } = await run(cliPath, ['auth', 'status', '--json'], { timeout: 15_000, env: childEnv() });
      const j = JSON.parse(auth);
      return { found: true, version, loggedIn: !!j.loggedIn, authMethod: j.authMethod };
    } catch (e) {
      // `auth status` exits non-zero when signed out.
      const out = (e as { stdout?: string }).stdout;
      try {
        const j = JSON.parse(out ?? '');
        return { found: true, version, loggedIn: !!j.loggedIn, authMethod: j.authMethod };
      } catch {
        return { found: true, version, loggedIn: false };
      }
    }
  } catch (e) {
    return { found: false, error: (e as Error).message };
  }
}

/**
 * Use the subscription the user is signed in with, not API billing:
 * an ANTHROPIC_API_KEY in the environment would take precedence inside Claude Code.
 */
function childEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

/** Claude Code's print mode takes one prompt, so earlier turns are rendered as a transcript. */
export function renderConversation(messages: AIMessage[]): string {
  if (messages.length === 1) return messages[0].content;
  const history = messages
    .slice(0, -1)
    .map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`)
    .join('\n');
  return `<conversation_so_far>\n${history}\n</conversation_so_far>\n\nReply to the latest message from the user, continuing the conversation above:\n\n${messages.at(-1)!.content}`;
}

/**
 * Runs the local Claude Code CLI in headless print mode (`claude -p`) with all tools,
 * MCP servers and settings disabled, so it behaves as a plain chat model that uses
 * the user's Claude subscription login.
 */
export class ClaudeCodeProvider implements AIProvider {
  readonly id = 'claude-code' as const;

  constructor(private cliPath: string) {}

  async stream(req: AIRequest, onText: (delta: string) => void): Promise<AIResult> {
    // Run from an empty directory so no project CLAUDE.md or files are picked up.
    const workDir = path.join(CACHE_DIR, 'claude-code');
    fs.mkdirSync(workDir, { recursive: true });
    // The context can exceed the OS limit for a single argument, so pass it as a file.
    const systemFile = path.join(workDir, `system-${randomUUID()}.txt`);
    fs.writeFileSync(systemFile, req.system, { mode: 0o600 });

    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--tools', '',
      '--strict-mcp-config',
      '--setting-sources', '',
      '--no-session-persistence',
      '--system-prompt-file', systemFile,
      ...(req.model ? ['--model', req.model] : []),
    ];

    try {
      return await new Promise<AIResult>((resolve, reject) => {
        const child = spawn(this.cliPath, args, { cwd: workDir, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
        let buf = '';
        let stderr = '';
        let streamed = '';
        let result: { text: string; isError: boolean; stopReason?: string } | undefined;

        const onAbort = () => child.kill('SIGTERM');
        req.signal?.addEventListener('abort', onAbort, { once: true });

        child.stdout.on('data', (d: Buffer) => {
          buf += d.toString('utf8');
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let ev: any;
            try {
              ev = JSON.parse(line);
            } catch {
              continue;
            }
            if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && ev.event.delta?.type === 'text_delta') {
              streamed += ev.event.delta.text;
              onText(ev.event.delta.text);
            } else if (ev.type === 'result') {
              result = { text: String(ev.result ?? ''), isError: !!ev.is_error, stopReason: ev.stop_reason ?? ev.subtype };
            }
          }
        });
        child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
        child.stdin.on('error', () => {});
        child.on('error', (e) =>
          reject(new Error(`Could not start Claude Code (${this.cliPath}): ${e.message}. Install it or set its path in Settings → AI.`)),
        );
        child.on('close', (code) => {
          req.signal?.removeEventListener('abort', onAbort);
          if (req.signal?.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          if (result?.isError || (!result && code !== 0)) {
            const msg = (result?.text || stderr.trim() || `exited with code ${code}`).slice(0, 500);
            const hint = /log ?in|auth|credential|401/i.test(msg) ? ' Run `claude` in a terminal and sign in (or `claude auth login`).' : '';
            return reject(new Error(`Claude Code error: ${msg}${hint}`));
          }
          // If nothing was streamed (e.g. partial messages unsupported), emit the final text at once.
          const text = result?.text ?? streamed;
          if (!streamed && text) onText(text);
          resolve({ text, stopReason: result?.stopReason });
        });

        child.stdin.end(renderConversation(req.messages));
      });
    } finally {
      fs.rmSync(systemFile, { force: true });
    }
  }
}
