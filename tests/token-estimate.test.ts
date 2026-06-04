import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../src/llm/types.js';
import {
  estimateContextUsage,
  estimateMessageTokens,
  estimateTextTokens,
  formatContextUsageLines
} from '../src/core/token-estimate.js';

describe('token-estimate', () => {
  it('estimates English text roughly by char/4', () => {
    const text = 'hello world test';
    const est = estimateTextTokens(text);
    expect(est.chars).toBe(text.length);
    expect(est.tokens).toBeGreaterThan(0);
    expect(est.tokens).toBeLessThan(text.length);
  });

  it('estimates CJK text with higher token density', () => {
    const en = estimateTextTokens('abcd').tokens;
    const zh = estimateTextTokens('中文测试').tokens;
    expect(zh).toBeGreaterThanOrEqual(en);
  });

  it('includes tool_calls in message estimate', () => {
    const msg: ChatMessage = {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'c1',
        name: 'read_file',
        arguments: { path: 'README.md' }
      }]
    };
    expect(estimateMessageTokens(msg)).toBeGreaterThan(10);
  });

  it('summarizes context usage with percent', () => {
    const usage = estimateContextUsage('system prompt', [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' }
    ], 1000);

    expect(usage.systemTokens).toBeGreaterThan(0);
    expect(usage.historyTokens).toBeGreaterThan(0);
    expect(usage.totalTokens).toBe(usage.systemTokens + usage.historyTokens);
    expect(usage.messageCount).toBe(2);
    expect(usage.percent).toBeGreaterThan(0);
    expect(usage.percent).toBeLessThanOrEqual(100);
  });

  it('warns when context usage is high', () => {
    const longHistory: ChatMessage[] = Array.from({ length: 40 }, (_, i) => ({
      role: 'user',
      content: 'x'.repeat(500)
    }));
    const usage = estimateContextUsage('sys', longHistory, 5_000);
    const lines = formatContextUsageLines(usage);
    expect(usage.percent).toBeGreaterThanOrEqual(75);
    expect(lines.some((l) => l.includes('compact') || l.includes('high') || l.includes('warning'))).toBe(true);
  });
});
