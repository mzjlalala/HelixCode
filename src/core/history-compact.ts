/**
 * 按 token 预算压缩会话历史
 */

import type { ChatMessage } from '../llm/types.js';
import { estimateMessagesTokens } from './token-estimate.js';

const MIN_MESSAGES_AFTER_COMPACT = 4;

/**
 * 从尾部保留消息，直到估算 token 不超过 targetTokens。
 * 裁剪后移除开头孤立的 tool 消息。
 */
export function compactMessagesByTokenBudget(
  messages: ChatMessage[],
  targetTokens: number
): { messages: ChatMessage[]; removed: number } {
  if (messages.length === 0) return { messages: [], removed: 0 };

  const safeTarget = Math.max(500, Math.floor(targetTokens));
  const working = [...messages];
  let removed = 0;

  while (
    working.length > MIN_MESSAGES_AFTER_COMPACT
    && estimateMessagesTokens(working) > safeTarget
  ) {
    working.shift();
    removed += 1;
    while (working.length > 0 && working[0]?.role === 'tool') {
      working.shift();
      removed += 1;
    }
  }

  return { messages: working, removed };
}
