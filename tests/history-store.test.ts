import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadHistory, saveHistory } from '../src/core/history-store.js';
import type { ChatMessage } from '../src/llm/types.js';

describe('history-store', () => {
  const fakeMessages: ChatMessage[] = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there' },
    { role: 'user', content: 'How are you?' },
    { role: 'assistant', content: 'I am fine.' },
  ];

  it('loadHistory returns empty when no history file exists', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-history-'));
    const messages = await loadHistory(cwd);
    expect(messages).toEqual([]);
  });

  it('saveHistory and loadHistory round-trips messages', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-history-'));
    await saveHistory(cwd, fakeMessages);

    const loaded = await loadHistory(cwd);
    expect(loaded).toEqual(fakeMessages);
  });

  it('loadHistory returns empty for invalid JSON', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-history-'));
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(cwd, '.helix'), { recursive: true });
    await writeFile(join(cwd, '.helix', 'history.json'), 'not json', 'utf8');

    // Should not throw, return empty
    const messages = await loadHistory(cwd);
    expect(messages).toEqual([]);
  });

  it('limits saved messages to configured max (default 80)', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-history-'));
    const manyMessages: ChatMessage[] = [];
    for (let i = 0; i < 100; i++) {
      manyMessages.push({ role: 'user', content: `msg ${i}` });
    }

    await saveHistory(cwd, manyMessages);
    const loaded = await loadHistory(cwd);
    expect(loaded.length).toBeLessThanOrEqual(80);
    expect(loaded[0]?.content).toBe('msg 20');
  });

  it('honors custom maxSaved parameter', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-history-'));
    const manyMessages: ChatMessage[] = [];
    for (let i = 0; i < 50; i++) {
      manyMessages.push({ role: 'user', content: `msg ${i}` });
    }

    await saveHistory(cwd, manyMessages, 10);
    const loaded = await loadHistory(cwd);
    expect(loaded).toHaveLength(10);
    expect(loaded[0]?.content).toBe('msg 40');
  });
});
