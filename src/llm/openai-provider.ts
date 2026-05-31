import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam
} from 'openai/resources/chat/completions';
import type { HelixConfig } from '../core/config.js';
import type { ChatMessage, ChatProvider, ChatResult, ToolCall, ToolDefinition } from './types.js';

interface ToolCallResponse {
  id: string;
  type?: string;
  function: { name: string; arguments: string };
}

interface ChoiceResponse {
  message?: {
    content?: string | null;
    tool_calls?: ToolCallResponse[] | null;
    reasoning_content?: string | null;
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
      if (this.config.provider === 'deepseek') {
        params.extra_body = { thinking: { type: 'enabled' } };
      }

      const response = await this.client.chat.completions.create(params);
      const choice = response.choices?.[0]?.message;
      if (!choice) return { type: 'text', content: '' };

      const reasoning_content = choice.reasoning_content ?? null;

      if (choice.tool_calls && choice.tool_calls.length > 0) {
        const calls: ToolCall[] = choice.tool_calls
          .filter((tc) => !tc.type || tc.type === 'function')
          .map((tc) => {
            let parsed: Record<string, unknown> = {};
            try { parsed = JSON.parse(tc.function.arguments); } catch { /* use empty */ }
            return { id: tc.id, name: tc.function.name, arguments: parsed };
          });
        if (calls.length > 0) {
          return { type: 'tool_calls', calls, reasoning_content };
        }
      }

      return { type: 'text', content: choice.content ?? '', reasoning_content };
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
    options?: { signal?: AbortSignal; tools?: ToolDefinition[] }
  ): Promise<ChatResult> {
    if (!this.config.apiKey.trim()) {
      return { type: 'text', content: 'API key is not set.' };
    }

    try {
      const createParams: Record<string, unknown> = {
        model: this.runtime.model,
        messages: toOpenAIMessages(messages),
        temperature: 0.2,
        stream: true
      };

      if ((options?.tools ?? []).length > 0) {
        createParams.tools = buildOpenAITools(options!.tools!);
        createParams.tool_choice = 'auto';
      }

      if (this.config.provider === 'deepseek') {
        createParams.extra_body = { thinking: { type: 'enabled' } };
      }

      const stream = await (this.client as unknown as OpenAI).chat.completions.create(
        createParams as any,
        { signal: options?.signal }
      ) as unknown as AsyncIterable<{
        choices?: Array<{
          delta?: {
            content?: string | null;
            tool_calls?: Array<{
              index: number;
              id?: string;
              type?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      }>;

      let fullContent = '';
      const accumulatedCalls: Map<number, {
        id: string;
        name: string;
        args: string;
      }> = new Map();
      let hasToolCalls = false;

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // Stream text tokens
        if (delta.content) {
          onToken(delta.content);
          fullContent += delta.content;
        }

        // Accumulate tool_calls from stream deltas
        if (delta.tool_calls) {
          hasToolCalls = true;
          for (const tc of delta.tool_calls) {
            const existing = accumulatedCalls.get(tc.index) ?? {
              id: '',
              name: '',
              args: ''
            };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.args += tc.function.arguments;
            accumulatedCalls.set(tc.index, existing);
          }
        }
      }

      // Return tool_calls if any were accumulated
      if (hasToolCalls && accumulatedCalls.size > 0) {
        const calls: ToolCall[] = [...accumulatedCalls.entries()]
          .sort(([a], [b]) => a - b)
          .map(([_, tc]) => ({
            id: tc.id,
            name: tc.name,
            arguments: (() => { try { return JSON.parse(tc.args); } catch { return {}; } })()
          }))
          .filter((tc) => tc.id && tc.name);
        if (calls.length > 0) {
          return { type: 'tool_calls', calls };
        }
      }

      return { type: 'text', content: fullContent };
    } catch (error) {
      if (options?.signal?.aborted) return { type: 'text', content: '' };
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
    if (msg.role === 'assistant') {
      const m: Record<string, unknown> = { role: 'assistant', content: msg.content };
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        m.tool_calls = msg.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
        }));
      }
      if (msg.reasoning_content) {
        m.reasoning_content = msg.reasoning_content;
      }
      return m as unknown as ChatCompletionMessageParam;
    }
    return { role: msg.role, content: msg.content ?? '' };
  });
}
