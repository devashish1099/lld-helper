import { getSecret } from '../config.js';
import { AIConfigError, type AIProvider } from './AIProvider.js';
import { AnthropicProvider } from './AnthropicProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { ClaudeCodeProvider } from './ClaudeCodeProvider.js';

export type ProviderId = 'anthropic' | 'openai' | 'claude-code';
export const PROVIDER_IDS: ProviderId[] = ['anthropic', 'openai', 'claude-code'];

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-5',
  'claude-code': '', // empty = Claude Code's own default model
};

export class AIProviderFactory {
  private cache = new Map<string, AIProvider>();

  create(id: ProviderId, opts: { claudeCodePath?: string } = {}): AIProvider {
    // Claude Code uses the CLI's own sign-in (your Claude subscription); no API key involved.
    if (id === 'claude-code') return new ClaudeCodeProvider(opts.claudeCodePath || 'claude');
    const { value } = getSecret(id);
    if (!value) {
      const name = id === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
      throw new AIConfigError(`No API key configured for ${id === 'anthropic' ? 'Anthropic' : 'OpenAI'}. Add it in Settings → AI, or set ${name}.`);
    }
    const cacheKey = `${id}:${value}`;
    let p = this.cache.get(cacheKey);
    if (!p) {
      p = id === 'anthropic' ? new AnthropicProvider(value) : new OpenAIProvider(value);
      this.cache.clear(); // keys changed; drop stale clients
      this.cache.set(cacheKey, p);
    }
    return p;
  }
}
