export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIRequest {
  system: string;
  messages: AIMessage[];
  model: string;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface AIResult {
  text: string;
  stopReason?: string;
}

/** Provider-neutral streaming chat interface. Routes never touch provider SDKs directly. */
export interface AIProvider {
  readonly id: 'anthropic' | 'openai' | 'claude-code';
  stream(req: AIRequest, onText: (delta: string) => void): Promise<AIResult>;
}

export class AIConfigError extends Error {
  statusCode = 400;
}
