/**
 * OpenAI 兼容 fetch Provider
 *
 * 所有请求统一走 fetch()，消除 SDK 与 fetch 两套 SSE 解析路径的重复。
 * 支持非流式与流式 chat/completions，流式响应由 StreamAccumulator 增量累积。
 * 构造函数中的 `_client` 参数保留用于测试注入兼容，实际始终使用 fetch。
 */

import type { HelixConfig } from '../core/config.js';
import type { ChatMessage, ChatProvider, ChatResult, ToolCall, ToolDefinition } from './types.js';
import { parseTokenUsage, type TokenUsage } from './usage.js';

// ── 流式 delta 结构（SSE 解析后消费） ────────────────────────

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

// ── 流式累积器（所有流式路径共享） ────────────────────────────

/**
 * 累积 SSE 流中的 content、reasoning 与 tool_calls 分片。
 * tool_calls 按 index 合并 arguments 字符串，finalize 时解析为完整 ToolCall[]。
 */
class StreamAccumulator {
  fullContent = '';
  fullReasoning = '';
  /** 流式末 chunk 的 usage（需 stream_options.include_usage） */
  usage?: TokenUsage;
  private hasToolCalls = false;
  /** 按 stream index 合并同一 tool_call 的分片（id/name/arguments 可能分多 chunk 到达） */
  private calls = new Map<number, { id: string; name: string; args: string }>();

  addContent(token: string, onToken: (t: string) => void): void {
    onToken(token);
    this.fullContent += token;
  }

  addReasoning(text: string, onReasoning?: (t: string) => void): void {
    onReasoning?.(text);
    this.fullReasoning += text;
  }

  /** 处理单个 SSE delta，分发到 content / reasoning / tool_calls 分支。 */
  addDelta(
    delta: StreamDelta,
    onToken: (t: string) => void,
    onReasoning?: (t: string) => void,
    onToolCallDelta?: (event: {
      index: number;
      name?: string;
      argumentsDelta: string;
      argumentsSoFar: string;
    }) => void
  ): void {
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
        if (tc.function?.arguments) {
          existing.args += tc.function.arguments;
          const payload = {
            index: tc.index,
            argumentsDelta: tc.function.arguments,
            argumentsSoFar: existing.args
          };
          const toolName = existing.name || tc.function.name;
          onToolCallDelta?.(toolName ? { ...payload, name: toolName } : payload);
        } else if (tc.function?.name && existing.name) {
          onToolCallDelta?.({
            index: tc.index,
            name: existing.name,
            argumentsDelta: '',
            argumentsSoFar: existing.args
          });
        }
        this.calls.set(tc.index, existing);
      }
    }
  }

  /** 记录 SSE chunk 中的 usage（DeepSeek/OpenAI 流式末包） */
  setUsage(raw: unknown): void {
    const parsed = parseTokenUsage(raw);
    if (parsed) this.usage = parsed;
  }

  /** 流结束后组装最终 ChatResult：优先 tool_calls，否则返回文本。 */
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
        return withUsage(
          {
            type: 'tool_calls',
            calls: toolCalls,
            content: this.fullContent || null,
            reasoning_content: this.fullReasoning || null,
          },
          this.usage
        );
      }
    }
    return withUsage(
      { type: 'text', content: this.fullContent, reasoning_content: this.fullReasoning || null },
      this.usage
    );
  }
}

function withUsage<T extends ChatResult>(result: T, usage?: TokenUsage): ChatResult {
  return usage ? { ...result, usage } : result;
}

// ── OpenAI 工具格式转换 ──────────────────────────────────────

function buildOpenAITools(tools: ToolDefinition[]): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }));
}

/** 构建 chat/completions 请求体；DeepSeek 额外启用 thinking。 */
function buildRequestBody(
  config: HelixConfig,
  runtime: { model: string },
  messages: ChatMessage[],
  tools?: ToolDefinition[],
  stream?: boolean
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: runtime.model,
    messages: messages.map((msg) => serializeMessage(msg, config)),
    temperature: 0.2
  };
  if (stream) {
    body.stream = true;
    // DeepSeek / OpenAI：流式末 chunk 返回 usage（见 API 文档 stream_options）
    body.stream_options = { include_usage: true };
  }
  if (tools && tools.length > 0) {
    body.tools = buildOpenAITools(tools);
    body.tool_choice = 'auto';
  }
  if (needsDeepSeekThinkingReplay(config)) {
    body.thinking = { type: 'enabled' };
  }
  return body;
}

/** DeepSeek 思考模式重放历史时，assistant 必须带 reasoning_content（可为空串） */
export function needsDeepSeekThinkingReplay(config: HelixConfig): boolean {
  if (config.provider === 'deepseek') return true;
  if (config.baseURL.toLowerCase().includes('deepseek.com')) return true;
  return false;
}

/** 将内部 ChatMessage 序列化为 OpenAI API 消息格式。 */
function serializeMessage(msg: ChatMessage, config: HelixConfig): Record<string, unknown> {
  const m: Record<string, unknown> = { role: msg.role, content: msg.content ?? null };

  if (msg.role === 'assistant') {
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      m.tool_calls = msg.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
      }));
    }
    if (needsDeepSeekThinkingReplay(config)) {
      // DeepSeek 思考模式 + 工具调用：重放时缺少该字段会 400
      m.reasoning_content = msg.reasoning_content ?? '';
    } else if (msg.reasoning_content) {
      m.reasoning_content = msg.reasoning_content;
    }
  }

  if (msg.role === 'tool') {
    m.tool_call_id = msg.tool_call_id ?? '';
  }

  return m;
}

// ── 共享错误信息构建 ──────────────────────────────────────────

function buildErrorMessage(config: HelixConfig, runtime: { model: string }, detail: string): string {
  return [
    `Model request failed for provider ${config.provider}.`,
    `model: ${runtime.model}`,
    `base URL: ${config.baseURL}`,
    `error: ${detail}`
  ].join('\n');
}

// ── 非流式响应解析 ────────────────────────────────────────────

/** 解析 chat/completions 非流式 JSON 响应为 ChatResult。 */
function parseChatResponse(
  json: unknown
): ChatResult {
  const data = json as {
    usage?: unknown;
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

  const usage = parseTokenUsage(data.usage);
  const choice = data.choices?.[0]?.message;
  if (!choice) return withUsage({ type: 'text', content: '' }, usage);

  const reasoning_content = choice.reasoning_content ?? null;

  if (choice.tool_calls && choice.tool_calls.length > 0) {
    const calls: ToolCall[] = choice.tool_calls
      .filter((tc) => !tc.type || tc.type === 'function')
      .map((tc) => {
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(tc.function.arguments); } catch { /* 解析失败时使用空对象 */ }
        return { id: tc.id, name: tc.function.name, arguments: parsed };
      });
    if (calls.length > 0) {
      return withUsage({ type: 'tool_calls', calls, reasoning_content }, usage);
    }
  }

  return withUsage({ type: 'text', content: choice.content ?? '', reasoning_content }, usage);
}

// ── 非流式：fetch 实现 ────────────────────────────────────────

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

// ── 流式：fetch + StreamAccumulator ───────────────────────────

async function fetchCompleteStream(
  config: HelixConfig,
  runtime: { model: string },
  messages: ChatMessage[],
  onToken: (token: string) => void,
  onReasoning?: (text: string) => void,
  tools?: ToolDefinition[],
  signal?: AbortSignal,
  onToolCallDelta?: (event: {
    index: number;
    name?: string;
    argumentsDelta: string;
    argumentsSoFar: string;
  }) => void
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
        // 保留未完整的一行到下次 read
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') break;

          try {
            const chunk = JSON.parse(data) as {
              choices?: Array<{ delta?: StreamDelta; finish_reason?: string | null }>;
              usage?: unknown | null;
            };
            if (chunk.usage) acc.setUsage(chunk.usage);
            const delta = chunk.choices?.[0]?.delta;
            if (delta) acc.addDelta(delta, onToken, onReasoning, onToolCallDelta);
          } catch {
            // 跳过格式错误的 SSE 行
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

// ── OpenAIChatProvider 类 ─────────────────────────────────────

export class OpenAIChatProvider implements ChatProvider {
  private readonly runtime: { model: string };

  constructor(
    private readonly config: HelixConfig,
    runtime?: { model: string },
    _client?: unknown   // 保留用于测试注入向后兼容；实际始终使用 fetch
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
    options?: {
      signal?: AbortSignal;
      tools?: ToolDefinition[];
      onReasoning?: (text: string) => void;
      onToolCallDelta?: (event: {
        index: number;
        name?: string;
        argumentsDelta: string;
        argumentsSoFar: string;
      }) => void;
    }
  ): Promise<ChatResult> {
    if (!this.config.apiKey.trim()) {
      return { type: 'text', content: 'API key is not set.' };
    }
    return fetchCompleteStream(
      this.config, this.runtime, messages, onToken,
      options?.onReasoning, options?.tools, options?.signal, options?.onToolCallDelta
    );
  }
}

// ── 消息序列化（供外部消费者导出） ─────────────────────────────

export function toOpenAIMessages(
  messages: ChatMessage[],
  config: HelixConfig
): Record<string, unknown>[] {
  return messages.map((msg) => serializeMessage(msg, config));
}
