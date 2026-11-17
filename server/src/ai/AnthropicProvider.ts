import Anthropic from '@anthropic-ai/sdk';
import type { AIProvider, AIRequest, AIResult } from './AIProvider.js';

// Models that accept the server-side refusal fallback in its "default" form.
const FALLBACK_MODELS = /^claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)$/;

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic' as const;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async stream(req: AIRequest, onText: (delta: string) => void): Promise<AIResult> {
    const useFallback = FALLBACK_MODELS.test(req.model);
    const stream = this.client.beta.messages.stream(
      {
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: req.messages,
        ...(useFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal: req.signal },
    );
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') onText(event.delta.text);
    }
    const final = await stream.finalMessage();
    const text = final.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    if (final.stop_reason === 'refusal') {
      const note = '\n\n_[The model declined to answer this request.]_';
      onText(note);
      return { text: text + note, stopReason: 'refusal' };
    }
    if (final.stop_reason === 'max_tokens') {
      const note = '\n\n_[Response truncated: max tokens reached. Increase "Max response tokens" in Settings.]_';
      onText(note);
      return { text: text + note, stopReason: 'max_tokens' };
    }
    return { text, stopReason: final.stop_reason ?? undefined };
  }
}
