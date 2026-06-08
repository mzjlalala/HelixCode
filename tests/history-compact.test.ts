import { describe, expect, it } from 'vitest';
import { compactMessagesByTokenBudget } from '../src/core/history-compact.js';
import type { ChatMessage } from '../src/llm/types.js';

describe('history-compact', () => {
  it('drops old messages until under token budget', () => {
    const messages: ChatMessage[] = Array.from({ length: 30 }, (_, i) => ({
      role: 'user',
      content: `message ${i} ` + 'x'.repeat(400)
    }));

    const before = messages.length;
    const { messages: compacted, removed } = compactMessagesByTokenBudget(messages, 1500);
    expect(removed).toBeGreaterThan(0);
    expect(compacted.length).toBeLessThan(before);
  });
});
