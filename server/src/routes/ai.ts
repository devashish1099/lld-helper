import type { FastifyInstance } from 'fastify';
import type { Services } from '../services.js';
import { AI_MODES, DEFAULT_ACTION_MESSAGES, systemPromptFor, threadFor, type AIMode } from '../ai/prompts.js';
import type { AIMessage } from '../ai/AIProvider.js';
import { PROVIDER_IDS, type ProviderId } from '../ai/AIProviderFactory.js';

const HISTORY_LIMIT = 30;

export function registerAiRoutes(app: FastifyInstance, s: Services) {
  /**
   * Streams an AI response as Server-Sent Events:
   *   {type:'start', userMessage} → {type:'delta', text}* → {type:'done', message} | {type:'error', message}
   */
  app.post('/api/ai/chat', async (req, reply) => {
    const b = req.body as Record<string, any>;
    const mode = (b.mode ?? 'chat') as AIMode;
    if (!AI_MODES.includes(mode)) return reply.code(400).send({ error: `Unknown mode: ${mode}` });
    const problem = s.problems.get(String(b.problemId));
    const files = s.projects.fs(problem.slug);
    const settings = s.getSettings();
    const providerId: ProviderId = PROVIDER_IDS.includes(b.provider) ? b.provider : settings.aiProvider;
    const model = { anthropic: settings.anthropicModel, openai: settings.openaiModel, 'claude-code': settings.claudeCodeModel }[providerId];
    const provider = s.ai.create(providerId, { claudeCodePath: settings.claudeCodePath }); // throws a 400 with setup instructions when no key

    const thread = threadFor(mode);
    const userText = (typeof b.message === 'string' && b.message.trim()) || DEFAULT_ACTION_MESSAGES[mode] || '';
    if (!userText) return reply.code(400).send({ error: 'Message is required' });

    const ctx = s.context.build(mode, problem, s.db.listClarifications(problem.id), files, {
      activeFile: b.activeFile,
      includeActiveFile: !!b.includeActiveFile,
      includeProject: !!b.includeProject,
      attachedFiles: Array.isArray(b.attachedFiles) ? b.attachedFiles : [],
      pseudoFile: b.pseudoFile,
      runOutput: b.runOutput,
    });
    // Conversation history for multi-turn modes; one-shot actions don't need it.
    const history: AIMessage[] =
      mode === 'chat' || mode === 'interviewer'
        ? s.db.listMessages(problem.id, thread, HISTORY_LIMIT).map((m) => ({ role: m.role, content: m.content }))
        : [];
    // Providers require alternating roles that start with the user.
    while (history.length && history[0].role !== 'user') history.shift();

    const userRow = s.db.insertMessage({ problem_id: problem.id, thread, role: 'user', content: userText, mode });

    const abort = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) abort.abort(); // browser stopped/navigated away
    });
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (data: unknown) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    send({ type: 'start', userMessage: userRow, provider: providerId, model: model || 'default', includedFiles: ctx.includedFiles, truncated: ctx.truncated });

    let text = '';
    try {
      const result = await provider.stream(
        {
          system: systemPromptFor(mode, ctx.text),
          messages: [...history, { role: 'user', content: userText }],
          model,
          maxTokens: settings.maxTokens,
          signal: abort.signal,
        },
        (delta) => {
          text += delta;
          send({ type: 'delta', text: delta });
        },
      );
      const assistant = s.db.insertMessage({ problem_id: problem.id, thread, role: 'assistant', content: result.text || text, mode });
      send({ type: 'done', message: assistant, stopReason: result.stopReason });
    } catch (e) {
      const err = e as Error & { status?: number };
      const aborted = abort.signal.aborted;
      if (text) s.db.insertMessage({ problem_id: problem.id, thread, role: 'assistant', content: `${text}\n\n_[${aborted ? 'stopped' : 'interrupted by an error'}]_`, mode });
      if (!aborted) send({ type: 'error', message: describeAiError(err) });
      req.log.warn({ err: err.message }, 'AI request failed');
    } finally {
      reply.raw.end();
    }
  });
}

function describeAiError(e: Error & { status?: number }) {
  if (e.status === 401) return 'Authentication failed: the API key was rejected. Check it in Settings → AI.';
  if (e.status === 404) return `Model not found or not available to your account: ${e.message}`;
  if (e.status === 429) return 'Rate limited by the AI provider. Wait a moment and try again.';
  if ((e as any).code === 'ENOTFOUND' || /fetch failed|ECONNREFUSED|ENOTFOUND|Connection error/i.test(e.message))
    return 'Could not reach the AI provider. AI features need an internet connection.';
  return e.message || 'AI request failed';
}
