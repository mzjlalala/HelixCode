import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../src/llm/types.js';
import { sanitizeHistoryForLoad, validateToolCallHistory } from '../src/core/history-validate.js';

describe('history-validate', () => {
  it('accepts valid assistant + tool pairs', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', name: 'web_search', arguments: { query: 'test' } }]
      },
      { role: 'tool', content: '{}', tool_call_id: 'c1' },
      { role: 'assistant', content: 'done' }
    ];
    expect(validateToolCallHistory(messages).valid).toBe(true);
  });

  it('rejects multiple assistants before tool responses', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', name: 'web_search', arguments: {} }]
      },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c2', name: 'web_search', arguments: {} }]
      },
      { role: 'tool', content: '{}', tool_call_id: 'c1' }
    ];
    expect(validateToolCallHistory(messages).valid).toBe(false);
  });

  it('sanitizes by dropping invalid tail', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'ok' },
      { role: 'assistant', content: 'fine' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', name: 'web_search', arguments: {} }]
      },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c2', name: 'web_search', arguments: {} }]
      }
    ];
    const { messages: fixed, dropped } = sanitizeHistoryForLoad(messages);
    expect(dropped).toBeGreaterThan(0);
    expect(validateToolCallHistory(fixed).valid).toBe(true);
    expect(fixed).toHaveLength(2);
  });
});
