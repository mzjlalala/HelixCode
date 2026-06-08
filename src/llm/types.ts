/**
 * LLM 层类型定义
 * 描述与 OpenAI 兼容 API 交互时的消息、工具与 Provider 接口
 */

import type { TokenUsage } from './usage.js';

/** 模型返回的单次工具调用 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** 对话消息（兼容 OpenAI Chat Completions 格式） */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  /** DeepSeek 等模型的推理过程内容 */
  reasoning_content?: string | null;
}

/** LLM 一次 complete/completeStream 的返回结果 */
export type ChatResult =
  | { type: 'text'; content: string; reasoning_content?: string | null; usage?: TokenUsage }
  | {
      type: 'tool_calls';
      calls: ToolCall[];
      content?: string | null;
      reasoning_content?: string | null;
      usage?: TokenUsage;
    };

export type { TokenUsage } from './usage.js';

/** 传给模型的工具 schema（OpenAI function calling 格式） */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** 为 true 时需用户确认后才执行 */
  confirm?: boolean;
}

/** LLM 提供者抽象：Agent 只依赖此接口，便于测试注入 */
export interface ChatProvider {
  complete(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<ChatResult>;

  /** 流式输出；CLI REPL 模式下优先使用 */
  completeStream?(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    options?: {
      signal?: AbortSignal;
      tools?: ToolDefinition[];
      onReasoning?: (token: string) => void;
      /** tool_calls 参数 JSON 增量（写代码时流式预览） */
      onToolCallDelta?: (event: {
        index: number;
        name?: string;
        argumentsDelta: string;
        argumentsSoFar: string;
      }) => void;
    }
  ): Promise<ChatResult>;
}
