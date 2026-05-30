import { describe, expect, it } from 'vitest';
import { OpenAIChatProvider } from '../src/llm/openai-provider.js';
import type { HelixConfig } from '../src/core/config.js';

function config(overrides: Partial<HelixConfig> = {}): HelixConfig {
  return {
    name: 'HelixCode',
    cwd: 'D:/work/repo',
    provider: 'deepseek',
    apiKey: 'test-key',
    model: 'deepseek-chat',
    baseURL: 'https://api.deepseek.com',
    ...overrides
  };
}

describe('OpenAIChatProvider', () => {
  it('sends chat completions to an OpenAI-compatible client', async () => {
    const calls: unknown[] = [];
    const client = {
      chat: {
        completions: {
          create: async (request: unknown) => {
            calls.push(request);
            return { choices: [{ message: { content: 'hello from model' } }] };
          }
        }
      }
    };
    const provider = new OpenAIChatProvider(config(), { model: 'deepseek-reasoner' }, client);

    const result = await provider.complete([
      { role: 'system', content: 'You are HelixCode.' },
      { role: 'user', content: 'Hi' },
      { role: 'tool', content: '{"ok":true}' }
    ]);

    expect(result).toBe('hello from model');
    expect(calls).toEqual([
      {
        model: 'deepseek-reasoner',
        messages: [
          { role: 'system', content: 'You are HelixCode.' },
          { role: 'user', content: 'Hi' },
          { role: 'user', content: 'Tool observation:\n{"ok":true}' }
        ],
        temperature: 0.2
      }
    ]);
  });

  it('returns a clear provider error when the API call fails', async () => {
    const client = {
      chat: {
        completions: {
          create: async () => {
            throw new Error('401 invalid api key');
          }
        }
      }
    };
    const provider = new OpenAIChatProvider(config(), undefined, client);

    const result = await provider.complete([{ role: 'user', content: 'Hi' }]);

    expect(result).toContain('Model request failed');
    expect(result).toContain('deepseek');
    expect(result).toContain('deepseek-chat');
    expect(result).toContain('401 invalid api key');
  });
});
