// ── OpenAI-compatible fetch-based provider ──────────────────
//
// All requests go through fetch() to eliminate the duplicate
// SSE-parsing code paths that existed between the SDK-based
// and fetch-based implementations. The optional `_client`
// constructor parameter is kept for test injection compat
// but is silently ignored.

import type { HelixConfig } from '../core/config.js';
import type { ChatMessage, ChatProvider, ChatResult, ToolCall, ToolDefinition } from './types.js';

// ── Shared delta shape consumed by streaming ────────────────

interface StreamDelta {
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

// ── Stream accumulator (shared by all streaming paths) ──────

class StreamAccumulator {
  fullContent = '';
  private hasToolCalls = false;
  private calls = new Map<number, { id: string; name: string; args: string }>();

  addContent(token: string, onToken: (t: string) => void): void {
    onToken(token);
    this.fullContent += token;
  }

  addReasoning(text: string, onReasoning?: (t: string) => void): void {
    onReasoning?.(text);
  }

  addDelta(delta: StreamDelta, onToken: (t: string) => void, onReasoning?: (t: string) => void): void {
    if (delta.reasoning_content) {
      this.addReasoning(delta.reasoning_content, onReasoning);
    }
    if (delta.content) {
      this.addContent(delta.content, onToken);
    }
    if (delta.tool_calls) {
      this.hasToolCalls = true;
      for (const tc of delta.tool_calls) {
        const existing = this.calls.get(tc.index) ?? { id: '', name: '', args: '' };
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.name = tc.function.name;
        if (tc.function?.arguments) existing.args += tc.function.arguments;
        this.calls.set(tc.index, existing);
      }
    }
  }

  finalize(): ChatResult {
    if (this.hasToolCalls && this.calls.size > 0) {
      const toolCalls: ToolCall[] = [...this.calls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([_, tc]) => ({
          id: tc.id,
          name: tc.name,
          arguments: (() => { try { return JSON.parse(tc.args); } catch { return {}; } })()
        }))
        .filter((tc) => tc.id && tc.name);
      if (toolCalls.length > 0) {
        return { type: 'tool_calls', calls: toolCalls, content: this.fullContent || null };
      }
    }
    return { type: 'text', content: this.fullContent };
  }
}

// ── OpenAI tool formatting ──────────────────────────────────

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

// ── Shared error message builder ────────────────────────────

function buildErrorMessage(config: HelixConfig, runtime: { model: string }, detail: string): string {
  return [
    `Model request failed for provider ${config.provider}.`,
    `model: ${runtime.model}`,
    `base URL: ${config.baseURL}`,
    `error: ${detail}`
  ].join('\n');
}

// ── Shared non-streaming response parser ────────────────────

function parseChatResponse(
  json: unknown
): ChatResult {
  const data = json as {
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

  const choice = data.choices?.[0]?.message;
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

// ── Non-streaming: fetch-based ──────────────────────────────

async function fetchComplete(
  config: HelixConfig,
  runtime: { model: string },
  messages: ChatMessage[],
  tools?: ToolDefinition[]
): Promise<ChatResult> {
  const body = buildRequestBody(config, runtime, messages, tools, false);

  try {
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
      return { type: 'text', content: buildErrorMessage(config, runtime, `${response.status} ${errorText}`) };
    }

    const json = await response.json();
    return parseChatResponse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { type: 'text', content: buildErrorMessage(config, runtime, message) };
  }
}

// ── Streaming: fetch-based (uses shared StreamAccumulator) ──

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

  try {
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
      return { type: 'text', content: buildErrorMessage(config, runtime, `${response.status} ${errorText}`) };
    }

    const reader = response.body?.getReader();
    if (!reader) return { type: 'text', content: '' };

    const decoder = new TextDecoder();
    const acc = new StreamAccumulator();
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
            const chunk = JSON.parse(data) as { choices?: Array<{ delta?: StreamDelta; finish_reason?: string | null }> };
            const delta = chunk.choices?.[0]?.delta;
            if (delta) acc.addDelta(delta, onToken, onReasoning);
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

    return acc.finalize();
  } catch (error) {
    if (signal?.aborted) return { type: 'text', content: '' };
    const message = error instanceof Error ? error.message : String(error);
    return { type: 'text', content: buildErrorMessage(config, runtime, message) };
  }
}

// ── OpenAIChatProvider class ────────────────────────────────

export class OpenAIChatProvider implements ChatProvider {
  private readonly runtime: { model: string };

  constructor(
    private readonly config: HelixConfig,
    runtime?: { model: string },
    _client?: unknown   // kept for test-injection backward compat; always uses fetch
  ) {
    this.runtime = runtime ?? { model: config.model };
  }

  async complete(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<ChatResult> {
    if (!this.config.apiKey.trim()) {
      return { type: 'text', content: 'API key is not set.' };
    }
    return fetchComplete(this.config, this.runtime, messages, tools);
  }

  async completeStream(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    options?: { signal?: AbortSignal; tools?: ToolDefinition[]; onReasoning?: (text: string) => void }
  ): Promise<ChatResult> {
    if (!this.config.apiKey.trim()) {
      return { type: 'text', content: 'API key is not set.' };
    }
    return fetchCompleteStream(
      this.config, this.runtime, messages, onToken,
      options?.onReasoning, options?.tools, options?.signal
    );
  }
}

// ── Message serialization (exported for external consumers) ─

export function toOpenAIMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((msg): Record<string, unknown> => {
    if (msg.role === 'tool') {
      return {
        role: 'tool',
        content: msg.content ?? '',
        tool_call_id: msg.tool_call_id ?? ''
      };
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
      return m;
    }
    return { role: msg.role, content: msg.content ?? '' };
  });
}
