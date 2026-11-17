import OpenAI from 'openai';
import type { AIProvider, AIRequest, AIResult } from './AIProvider.js';

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai' as const;
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async stream(req: AIRequest, onText: (delta: string) => void): Promise<AIResult> {
    const stream = await this.client.chat.completions.create(
      {
        model: req.model,
        stream: true,
        max_completion_tokens: req.maxTokens,
        messages: [{ role: 'system', content: req.system }, ...req.messages],
      },
      { signal: req.signal },
    );
    let text = '';
    let stopReason: string | undefined;
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      const delta = choice?.delta?.content;
      if (delta) {
        text += delta;
        onText(delta);
      }
      if (choice?.finish_reason) stopReason = choice.finish_reason;
    }
    if (stopReason === 'length') {
      const note = '\n\n_[Response truncated: max tokens reached. Increase "Max response tokens" in Settings.]_';
      onText(note);
      text += note;
    }
    return { text, stopReason };
  }
}
