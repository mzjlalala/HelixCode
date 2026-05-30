import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/core/config.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('loadConfig', () => {
  it('loads HelixCode defaults', () => {
    delete process.env.HELIX_API_KEY;
    delete process.env.HELIX_CHAT_MODEL;
    delete process.env.HELIX_BASE_URL;

    const config = loadConfig({ cwd: 'D:/work/repo' });

    expect(config.name).toBe('HelixCode');
    expect(config.cwd).toBe('D:/work/repo');
    expect(config.model).toBe('gpt-4o');
    expect(config.baseURL).toBe('https://api.openai.com/v1');
  });

  it('honors environment overrides', () => {
    process.env.HELIX_API_KEY = 'test-key';
    process.env.HELIX_CHAT_MODEL = 'custom-model';
    process.env.HELIX_BASE_URL = 'https://example.test/v1';

    const config = loadConfig({ cwd: 'D:/work/repo' });

    expect(config.apiKey).toBe('test-key');
    expect(config.model).toBe('custom-model');
    expect(config.baseURL).toBe('https://example.test/v1');
  });
});
