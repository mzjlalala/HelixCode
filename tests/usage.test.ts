import { describe, expect, it } from 'vitest';
import { buildContextUsage, formatContextUsageLines } from '../src/core/token-estimate.js';
import { parseTokenUsage } from '../src/llm/usage.js';

describe('parseTokenUsage', () => {
  it('parses DeepSeek usage object', () => {
    const usage = parseTokenUsage({
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      prompt_cache_hit_tokens: 60,
      prompt_cache_miss_tokens: 40,
      completion_tokens_details: { reasoning_tokens: 15 }
    });

    expect(usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      prompt_cache_hit_tokens: 60,
      prompt_cache_miss_tokens: 40,
      completion_tokens_details: { reasoning_tokens: 15 }
    });
  });

  it('returns undefined for invalid usage', () => {
    expect(parseTokenUsage(null)).toBeUndefined();
    expect(parseTokenUsage({ prompt_tokens: 'x' })).toBeUndefined();
  });
});

describe('buildContextUsage', () => {
  it('uses API prompt_tokens when usage is in sync', () => {
    const usage = buildContextUsage(
      'system',
      [{ role: 'user', content: 'hi' }],
      64_000,
      { prompt_tokens: 12_000, completion_tokens: 100, total_tokens: 12_100 },
      false
    );

    expect(usage.totalTokens).toBe(12_000);
    expect(usage.percent).toBe(Math.round(12_000 / 64_000 * 100));
    expect(usage.lastRequest?.prompt_tokens).toBe(12_000);
    expect(usage.apiStale).toBeFalsy();
  });

  it('falls back to estimate when API is stale', () => {
    const usage = buildContextUsage(
      'system',
      [{ role: 'user', content: 'hi' }],
      64_000,
      { prompt_tokens: 50_000, completion_tokens: 1, total_tokens: 50_001 },
      true
    );

    expect(usage.apiStale).toBe(true);
    expect(usage.totalTokens).toBeLessThan(50_000);
    expect(usage.lastRequest?.prompt_tokens).toBe(50_000);
  });
});

describe('formatContextUsageLines', () => {
  it('shows API and cache lines from DeepSeek usage', () => {
    const usage = buildContextUsage(
      'sys',
      [],
      128_000,
      {
        prompt_tokens: 8000,
        completion_tokens: 200,
        total_tokens: 8200,
        prompt_cache_hit_tokens: 5000,
        prompt_cache_miss_tokens: 3000
      },
      false
    );

    const lines = formatContextUsageLines(usage);
    expect(lines.some((l) => l.startsWith('context (API):'))).toBe(true);
    expect(lines.some((l) => l.includes('cache: hit'))).toBe(true);
  });
});
