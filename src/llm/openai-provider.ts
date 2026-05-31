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

function buildRequestBody(
  config: HelixConfig,
  runtime: { model: string },
  messages: ChatMessage[],
  tools?: ToolDefinition[],
  stream?: boolean
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: runtime.model,
    messages: messages.map(serializeMessage),
    temperature: 0.2
  };
  if (stream) body.stream = true;
  if (tools && tools.length > 0) {
    body.tools = buildOpenAITools(tools);
    body.tool_choice = 'auto';
  }
  if (config.provider === 'deepseek') {
    body.extra_body = { thinking: { type: 'enabled' } };
  }
  return body;
}

function serializeMessage(msg: ChatMessage): Record<string, unknown> {
  const m: Record<string, unknown> = { role: msg.role, content: msg.content ?? null };

  if (msg.role === 'assistant') {
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      m.tool_calls = msg.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
      }));
    }
    if (msg.reasoning_content) {
      m.reasoning_content = msg.reasoning_content;
    }
  }

  if (msg.role === 'tool') {
    m.tool_call_id = msg.tool_call_id ?? '';
  }

  return m;
}

async function fetchComplete(
  config: HelixConfig,
  runtime: { model: string },
  messages: ChatMessage[],
  tools?: ToolDefinition[]
): Promise<ChatResult> {
  const body = buildRequestBody(config, runtime, messages, tools, false);

  const response = await fetch(`${config.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    return {
      type: 'text',
      content: [
        `Model request failed for provider ${config.provider}.`,
        `model: ${runtime.model}`,
        `base URL: ${config.baseURL}`,
        `error: ${response.status} ${errorText}`
      ].join('\n')
    };
  }

  const json = await response.json() as {
    choices?: Array<{
      message: {
        content?: string | null;
        tool_calls?: Array<{
          id: string;
          type?: string;
          function: { name: string; arguments: string };
        }> | null;
        reasoning_content?: string | null;
      };
    }>;
  };

  const choice = json.choices?.[0]?.message;
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
}

async function fetchCompleteStream(
  config: HelixConfig,
  runtime: { model: string },
  messages: ChatMessage[],
  onToken: (token: string) => void,
  onReasoning?: (text: string) => void,
  tools?: ToolDefinition[],
  signal?: AbortSignal
): Promise<ChatResult> {
  const body = buildRequestBody(config, runtime, messages, tools, true);

  const response = await fetch(`${config.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(body),
    signal: signal ?? null
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    return {
      type: 'text',
      content: [
        `Model request failed for provider ${config.provider}.`,
        `model: ${runtime.model}`,
        `base URL: ${config.baseURL}`,
        `error: ${response.status} ${errorText}`
      ].join('\n')
    };
  }

  const reader = response.body?.getReader();
  if (!reader) return { type: 'text', content: '' };

  const decoder = new TextDecoder();
  let fullContent = '';
  const accumulatedCalls: Map<number, { id: string; name: string; args: string }> = new Map();
  let hasToolCalls = false;
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') break;

        try {
          const chunk = JSON.parse(data) as {
            choices?: Array<{
              delta?: {
                content?: string | null;
                reasoning_content?: string | null;
                tool_calls?: Array<{
                  index: number;
                  id?: string;
                  type?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string | null;
            }>;
          };

          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.reasoning_content && onReasoning) {
            onReasoning(delta.reasoning_content);
          }

          if (delta.content) {
            onToken(delta.content);
            fullContent += delta.content;
          }

          if (delta.tool_calls) {
            hasToolCalls = true;
            for (const tc of delta.tool_calls) {
              const existing = accumulatedCalls.get(tc.index) ?? { id: '', name: '', args: '' };
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name = tc.function.name;
              if (tc.function?.arguments) existing.args += tc.function.arguments;
              accumulatedCalls.set(tc.index, existing);
            }
          }
        } catch {
          // skip malformed JSON lines
        }
      }
    }
  } catch (error) {
    if (signal?.aborted) return { type: 'text', content: '' };
    throw error;
  } finally {
    reader.releaseLock();
  }

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
      return { type: 'tool_calls', calls, content: fullContent || null };
    }
  }

  return { type: 'text', content: fullContent };
}

export class OpenAIChatProvider implements ChatProvider {
  private readonly client: OpenAICompatibleClient | null;
  private readonly runtime: { model: string };

  constructor(
    private readonly config: HelixConfig,
    runtime?: { model: string },
    client?: OpenAICompatibleClient
  ) {
    this.runtime = runtime ?? { model: config.model };
    this.client = client ?? (config.provider === 'deepseek' ? null : new OpenAI({
      apiKey: config.apiKey || 'missing-key',
      baseURL: config.baseURL
    }) as unknown as OpenAICompatibleClient);
  }

  async complete(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<ChatResult> {
    if (!this.config.apiKey.trim()) {
      return { type: 'text', content: 'API key is not set.' };
    }

    // DeepSeek without injected client: use fetch() directly to ensure reasoning_content is serialized
    if (this.config.provider === 'deepseek' && !this.client) {
      return fetchComplete(this.config, this.runtime, messages, tools);
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

      const response = await this.client!.chat.completions.create(params);
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
    options?: { signal?: AbortSignal; tools?: ToolDefinition[]; onReasoning?: (text: string) => void }
  ): Promise<ChatResult> {
    if (!this.config.apiKey.trim()) {
      return { type: 'text', content: 'API key is not set.' };
    }

    // DeepSeek without injected client: use fetch() directly for streaming too
    if (this.config.provider === 'deepseek' && !this.client) {
      return fetchCompleteStream(
        this.config, this.runtime, messages, onToken, options?.onReasoning,
        options?.tools, options?.signal
      );
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
            reasoning_content?: string | null;
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

        if (delta.reasoning_content && options?.onReasoning) {
          options.onReasoning(delta.reasoning_content);
        }

        if (delta.content) {
          onToken(delta.content);
          fullContent += delta.content;
        }

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
          return { type: 'tool_calls', calls, content: fullContent || null };
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
