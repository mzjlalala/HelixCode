import OpenAI from 'openai';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam
} from 'openai/resources/chat/completions';
import type { HelixConfig } from '../core/config.js';
import type { ChatMessage, ChatProvider } from './types.js';

export interface OpenAICompatibleClient {
  chat: {
    completions: {
      create(request: ChatCompletionCreateParamsNonStreaming): Promise<{
        choices?: Array<{ message?: { content?: string | null } }>;
      }>;
    };
  };
}

export class OpenAIChatProvider implements ChatProvider {
  private readonly client: OpenAICompatibleClient;
  private readonly runtime: { model: string };

  constructor(
    private readonly config: HelixConfig,
    runtime?: { model: string },
    client?: OpenAICompatibleClient
  ) {
    this.runtime = runtime ?? { model: config.model };
    this.client = client ?? new OpenAI({
      apiKey: config.apiKey || 'missing-key',
      baseURL: config.baseURL
    });
  }

  async complete(messages: ChatMessage[]): Promise<string> {
    if (!this.config.apiKey.trim()) {
      return 'HELIX_API_KEY, DEEPSEEK_API_KEY, or OPENAI_API_KEY is not set. Set one API key to enable HelixCode agent reasoning.';
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.runtime.model,
        messages: toOpenAIMessages(messages),
        temperature: 0.2
      });

      return response.choices?.[0]?.message?.content ?? '';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return [
        `Model request failed for provider ${this.config.provider}.`,
        `model: ${this.runtime.model}`,
        `base URL: ${this.config.baseURL}`,
        `error: ${message}`
      ].join('\n');
    }
  }
}

export function toOpenAIMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
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
