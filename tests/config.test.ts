import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, loadProjectInstructions } from '../src/core/config.js';

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

describe('loadProjectInstructions', () => {
  it('loads AGENTS.md and .helix instructions from the project root', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-config-'));
    await writeFile(join(cwd, 'AGENTS.md'), 'Use JDK 17 from C:/DevelopTool/JDK17.\n', 'utf8');
    await mkdir(join(cwd, '.helix'), { recursive: true });
    await writeFile(join(cwd, '.helix', 'instructions.md'), 'Prefer small tests.\n', 'utf8');

    const instructions = await loadProjectInstructions(cwd);

    expect(instructions).toEqual([
      { path: 'AGENTS.md', content: 'Use JDK 17 from C:/DevelopTool/JDK17.\n' },
      { path: '.helix/instructions.md', content: 'Prefer small tests.\n' }
    ]);
  });
});
