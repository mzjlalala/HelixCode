import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { HelixConfig } from '../core/config.js';
import type { ChatMessage, ChatProvider } from './types.js';

export class OpenAIChatProvider implements ChatProvider {
  private readonly client: OpenAI;

  constructor(private readonly config: HelixConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey || 'missing-key',
      baseURL: config.baseURL
    });
  }

  async complete(messages: ChatMessage[]): Promise<string> {
    if (!this.config.apiKey.trim()) {
      return 'HELIX_API_KEY is not set. Set HELIX_API_KEY to enable HelixCode agent reasoning.';
    }

    const response = await this.client.chat.completions.create({
      model: this.config.model,
      messages: toOpenAIMessages(messages),
      temperature: 0.2
    });

    return response.choices[0]?.message.content ?? '';
  }
}

function toOpenAIMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'user',
        content: `Tool observation:\n${message.content}`
      };
    }

    return {
      role: message.role,
      content: message.content
    };
  });
}
