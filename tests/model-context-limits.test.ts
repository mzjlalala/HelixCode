import { describe, expect, it } from 'vitest';
import {
  lookupModelContextLimit,
  resolveContextTokenLimit
} from '../src/core/model-context-limits.js';

describe('model-context-limits', () => {
  it('reads limit from modelContextLimits in config', () => {
    expect(resolveContextTokenLimit('deepseek-v4-pro', {
      modelContextLimits: { 'deepseek-v4-pro': 1_000_000 }
    }, 'deepseek')).toBe(1_000_000);
  });

  it('matches model names case-insensitively', () => {
    expect(resolveContextTokenLimit('DeepSeek-V4-Pro', {
      modelContextLimits: { 'deepseek-v4-pro': 1_000_000 }
    }, 'deepseek')).toBe(1_000_000);
  });

  it('falls back to global contextTokenLimit when model is not in map', () => {
    expect(resolveContextTokenLimit('unknown-model', {
      contextTokenLimit: 200_000
    }, 'openai')).toBe(200_000);
  });

  it('falls back to provider default when nothing is configured', () => {
    expect(resolveContextTokenLimit('unknown-model', {}, 'deepseek')).toBe(64_000);
    expect(resolveContextTokenLimit('unknown-model', {}, 'openai')).toBe(128_000);
  });

  it('lookupModelContextLimit finds keys case-insensitively', () => {
    expect(lookupModelContextLimit('GPT-4o', { 'gpt-4o': 999 })).toBe(999);
  });
});
