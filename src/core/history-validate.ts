/**
 * 会话历史 tool_calls 配对校验
 *
 * OpenAI/DeepSeek 要求：含 tool_calls 的 assistant 消息后，每条 call 必须有对应 tool 消息。
 */

import type { ChatMessage } from '../llm/types.js';

export interface HistoryValidationResult {
  valid: boolean;
  /** 人类可读错误说明 */
  error?: string;
  /** 出错的消息下标 */
  index?: number;
}

/** 校验消息列表中 assistant tool_calls 与 tool 响应是否成对、顺序是否正确 */
export function validateToolCallHistory(messages: ChatMessage[]): HistoryValidationResult {
  let pendingIds: string[] | null = null;

  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i]!;

    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      if (pendingIds?.length) {
        return {
          valid: false,
          index: i,
          error: 'assistant tool_calls appeared before previous tool_calls were answered'
        };
      }
      pendingIds = msg.tool_calls.map((tc) => tc.id).filter(Boolean);
      if (pendingIds.length !== msg.tool_calls.length) {
        return {
          valid: false,
          index: i,
          error: 'assistant tool_calls contains entries without id'
        };
      }
      continue;
    }

    if (msg.role === 'tool') {
      const id = msg.tool_call_id?.trim() ?? '';
      if (!pendingIds?.length) {
        return { valid: false, index: i, error: 'orphan tool message without preceding assistant tool_calls' };
      }
      if (!id || !pendingIds.includes(id)) {
        return { valid: false, index: i, error: `tool message tool_call_id "${id}" does not match pending calls` };
      }
      pendingIds = pendingIds.filter((pid) => pid !== id);
      if (pendingIds.length === 0) pendingIds = null;
    }
  }

  if (pendingIds?.length) {
    return {
      valid: false,
      error: `unanswered tool_calls: ${pendingIds.join(', ')}`
    };
  }

  return { valid: true };
}

/**
 * 加载历史前的修复：保留校验通过的前缀，丢弃尾部损坏段。
 * @returns 可安全送入 Agent 的消息与丢弃条数
 */
export function sanitizeHistoryForLoad(messages: ChatMessage[]): {
  messages: ChatMessage[];
  dropped: number;
  reason?: string;
} {
  if (messages.length === 0) return { messages: [], dropped: 0 };

  const full = validateToolCallHistory(messages);
  if (full.valid) return { messages: [...messages], dropped: 0 };

  // 从尾部向前尝试最短有效前缀
  for (let end = messages.length - 1; end >= 0; end -= 1) {
    const prefix = messages.slice(0, end);
    const check = validateToolCallHistory(prefix);
    if (check.valid) {
      const dropped = messages.length - end;
      return {
        messages: prefix,
        dropped,
        ...(full.error ? { reason: full.error } : {})
      };
    }
  }

  return {
    messages: [],
    dropped: messages.length,
    ...(full.error ? { reason: full.error } : {})
  };
}
