import { describe, expect, it, vi } from 'vitest';
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
  it('returns a text response via fetch (unified path)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'hello from model' } }]
      })
    });
    vi.stubGlobal('fetch', mockFetch);

    const provider = new OpenAIChatProvider(config(), { model: 'deepseek-reasoner' });
    const result = await provider.complete([
      { role: 'user', content: 'Hi' }
    ]);

    expect(result).toEqual({ type: 'text', content: 'hello from model', reasoning_content: null, usage: undefined });

    // Verify fetch was called with the right URL and body shape
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(callArgs[0]).toBe('https://api.deepseek.com/chat/completions');

    const body = JSON.parse(callArgs[1].body as string) as Record<string, unknown>;
    expect(body.model).toBe('deepseek-reasoner');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);
    expect(body.temperature).toBe(0.2);
    expect(body.thinking).toEqual({ type: 'enabled' });

    vi.unstubAllGlobals();
  });

  it('returns a clear provider error when the API call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('401 invalid api key')));

    const provider = new OpenAIChatProvider(config());
    const result = await provider.complete([{ role: 'user', content: 'Hi' }]);

    expect(result.type).toBe('text');
    if (result.type === 'text') {
      expect(result.content).toContain('Model request failed');
      expect(result.content).toContain('deepseek');
      expect(result.content).toContain('deepseek-chat');
      expect(result.content).toContain('401 invalid api key');
    }

    vi.unstubAllGlobals();
  });

  it('returns API key error when key is empty', async () => {
    const provider = new OpenAIChatProvider(config({ apiKey: '' }));
    const result = await provider.complete([{ role: 'user', content: 'Hi' }]);
    expect(result).toEqual({ type: 'text', content: 'API key is not set.' });
  });

  it('handles tool_calls response from fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"test.txt"}' }
            }]
          }
        }]
      })
    }));

    const provider = new OpenAIChatProvider(config());
    const result = await provider.complete(
      [{ role: 'user', content: 'Read test.txt' }],
      [{ name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: {} } }]
    );

    expect(result.type).toBe('tool_calls');
    if (result.type === 'tool_calls') {
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0]).toMatchObject({ id: 'call_1', name: 'read_file' });
    }

    vi.unstubAllGlobals();
  });

  it('parses usage from non-streaming response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
        usage: {
          prompt_tokens: 42,
          completion_tokens: 7,
          total_tokens: 49,
          prompt_cache_hit_tokens: 10,
          prompt_cache_miss_tokens: 32
        }
      })
    }));

    const provider = new OpenAIChatProvider(config());
    const result = await provider.complete([{ role: 'user', content: 'Hi' }]);

    expect(result.usage).toEqual({
      prompt_tokens: 42,
      completion_tokens: 7,
      total_tokens: 49,
      prompt_cache_hit_tokens: 10,
      prompt_cache_miss_tokens: 32
    });

    vi.unstubAllGlobals();
  });

  it('requests stream_options.include_usage when streaming', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'));
        controller.enqueue(encoder.encode(
          'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n'
        ));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: stream
    }));

    const provider = new OpenAIChatProvider(config());
    const result = await provider.completeStream([{ role: 'user', content: 'Hi' }], () => {});

    expect(result.usage).toEqual({
      prompt_tokens: 5,
      completion_tokens: 2,
      total_tokens: 7
    });

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.stream_options).toEqual({ include_usage: true });

    vi.unstubAllGlobals();
  });
});
