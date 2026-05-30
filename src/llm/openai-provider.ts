import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam
} from 'openai/resources/chat/completions';
import type { HelixConfig } from '../core/config.js';
import type { ChatMessage, ChatProvider, ChatResult, ToolCall, ToolDefinition } from './types.js';

// Response shape common to OpenAI and compatible providers
interface ToolCallResponse {
  id: string;
  type?: string;
  function: { name: string; arguments: string };
}

interface ChoiceResponse {
  message?: {
    content?: string | null;
    tool_calls?: ToolCallResponse[] | null;
  };
}

export interface OpenAICompatibleClient {
  chat: {
    completions: {
      create(request: Record<string, unknown>): Promise<{
        choices?: ChoiceResponse[] | null;
      }>;
    };
  };
}

function buildOpenAITools(tools: ToolDefinition[]): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }));
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
    this.client = (client ?? new OpenAI({
      apiKey: config.apiKey || 'missing-key',
      baseURL: config.baseURL
    })) as unknown as OpenAICompatibleClient;
  }

  async complete(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<ChatResult> {
    if (!this.config.apiKey.trim()) {
      return { type: 'text', content: 'API key is not set.' };
    }

    try {
      const params: Record<string, unknown> = {
        model: this.runtime.model,
        messages: toOpenAIMessages(messages),
        temperature: 0.2
      };
      if (tools && tools.length > 0) {
        params.tools = buildOpenAITools(tools);
        params.tool_choice = 'auto';
      }

      const response = await this.client.chat.completions.create(params);
      const choice = response.choices?.[0]?.message;
      if (!choice) return { type: 'text', content: '' };

      // Native tool calls
      if (choice.tool_calls && choice.tool_calls.length > 0) {
        const calls: ToolCall[] = choice.tool_calls
          .filter((tc) => !tc.type || tc.type === 'function')
          .map((tc) => {
            let parsed: Record<string, unknown> = {};
            try { parsed = JSON.parse(tc.function.arguments); } catch { /* use empty */ }
            return { id: tc.id, name: tc.function.name, arguments: parsed };
          });
        if (calls.length > 0) return { type: 'tool_calls', calls };
      }

      return { type: 'text', content: choice.content ?? '' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        type: 'text',
        content: [
          `Model request failed for provider ${this.config.provider}.`,
          `model: ${this.runtime.model}`,
          `base URL: ${this.config.baseURL}`,
          `error: ${message}`
        ].join('\n')
      };
    }
  }

  async completeStream(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    options?: { signal?: AbortSignal }
  ): Promise<string> {
    if (!this.config.apiKey.trim()) {
      return 'API key is not set.';
    }

    try {
      const stream = await (this.client as unknown as OpenAI).chat.completions.create(
        {
          model: this.runtime.model,
          messages: toOpenAIMessages(messages) as ChatCompletionMessageParam[],
          temperature: 0.2,
          stream: true
        },
        { signal: options?.signal }
      ) as AsyncIterable<{
        choices?: Array<{ delta?: { content?: string | null } }>;
      }>;

      let fullContent = '';
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          onToken(delta);
          fullContent += delta;
        }
      }
      return fullContent;
    } catch (error) {
      if (options?.signal?.aborted) return '';
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
  return messages.map((msg): ChatCompletionMessageParam => {
    if (msg.role === 'tool') {
      return {
        role: 'tool',
        content: msg.content ?? '',
        tool_call_id: msg.tool_call_id ?? ''
      } as ChatCompletionMessageParam;
    }
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      return {
        role: 'assistant',
        content: msg.content,
        tool_calls: msg.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
        }))
      } as ChatCompletionMessageParam;
    }
    return { role: msg.role, content: msg.content ?? '' };
  });
}
