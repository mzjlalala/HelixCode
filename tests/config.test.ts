import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, loadProjectInstructions, loadFileConfig, saveFileConfig, loadPermissionMode, savePermissionMode, mergeFileConfig, resolveSessionSettings } from '../src/core/config.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('loadConfig', () => {
  it('loads HelixCode defaults', () => {
    delete process.env.HELIX_PROVIDER;
    delete process.env.HELIX_API_KEY;
    delete process.env.HELIX_CHAT_MODEL;
    delete process.env.HELIX_MODEL;
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

  it('uses DeepSeek defaults when HELIX_PROVIDER is deepseek', () => {
    process.env.HELIX_PROVIDER = 'deepseek';
    process.env.DEEPSEEK_API_KEY = 'deepseek-key';
    delete process.env.HELIX_CHAT_MODEL;
    delete process.env.HELIX_MODEL;
    delete process.env.HELIX_BASE_URL;

    const config = loadConfig({ cwd: 'D:/work/repo' });

    expect(config.provider).toBe('deepseek');
    expect(config.apiKey).toBe('deepseek-key');
    expect(config.model).toBe('deepseek-chat');
    expect(config.baseURL).toBe('https://api.deepseek.com');
  });
  it('infers DeepSeek provider from a DeepSeek base URL', () => {
    delete process.env.HELIX_PROVIDER;
    process.env.HELIX_BASE_URL = 'https://api.deepseek.com';
    process.env.DEEPSEEK_API_KEY = 'deepseek-key';

    const config = loadConfig({ cwd: 'D:/work/repo' });

    expect(config.provider).toBe('deepseek');
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

describe('config file (.helix/config.json)', () => {
  it('loadFileConfig returns empty when no config file exists', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-filecfg-'));
    const config = await loadFileConfig(cwd);
    expect(config).toEqual({});
  });

  it('loadFileConfig reads an existing config file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-filecfg-'));
    await mkdir(join(cwd, '.helix'), { recursive: true });
    await writeFile(
      join(cwd, '.helix', 'config.json'),
      JSON.stringify({ model: 'gpt-4o-mini', permissionMode: 'auto' }),
      'utf8'
    );

    const config = await loadFileConfig(cwd);
    expect(config.model).toBe('gpt-4o-mini');
    expect(config.permissionMode).toBe('auto');
  });

  it('saveFileConfig creates and merges config file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-filecfg-'));
    await mkdir(join(cwd, '.helix'), { recursive: true });

    // Save first field
    await saveFileConfig(cwd, { permissionMode: 'plan' });
    let config = await loadFileConfig(cwd);
    expect(config.permissionMode).toBe('plan');

    // Save second field — first field preserved
    await saveFileConfig(cwd, { model: 'custom-model' });
    config = await loadFileConfig(cwd);
    expect(config.permissionMode).toBe('plan');
    expect(config.model).toBe('custom-model');
  });

  it('loadPermissionMode returns undefined when no config', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-filecfg-'));
    expect(await loadPermissionMode(cwd)).toBeUndefined();
  });

  it('savePermissionMode persists the mode', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-filecfg-'));
    await savePermissionMode(cwd, 'acceptEdits');
    const mode = await loadPermissionMode(cwd);
    expect(mode).toBe('acceptEdits');
  });

  it('mergeFileConfig does not override env-set model', async () => {
    process.env.HELIX_CHAT_MODEL = 'env-model';
    const base = loadConfig({ cwd: '/test' });
    // File config model should NOT override env variable
    const merged = mergeFileConfig(base, { model: 'file-model' });
    expect(merged.model).toBe('env-model');
    delete process.env.HELIX_CHAT_MODEL;
  });

  it('mergeFileConfig applies file model when no env override', async () => {
    delete process.env.HELIX_CHAT_MODEL;
    delete process.env.HELIX_MODEL;
    const base = loadConfig({ cwd: '/test' });
    const merged = mergeFileConfig(base, { model: 'file-model' });
    expect(merged.model).toBe('file-model');
  });

  it('loadProjectInstructions honors config file instructions paths', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-instr-'));
    await mkdir(join(cwd, '.helix'), { recursive: true });
    await writeFile(join(cwd, '.helix', 'config.json'), JSON.stringify({ instructions: ['CUSTOM.md'] }), 'utf8');
    await writeFile(join(cwd, 'CUSTOM.md'), 'Custom instruction.', 'utf8');

    const instructions = await loadProjectInstructions(cwd);
    expect(instructions).toEqual([{ path: 'CUSTOM.md', content: 'Custom instruction.' }]);
  });
});

describe('resolveSessionSettings', () => {
  it('uses defaults when file config omits session fields', () => {
    expect(resolveSessionSettings({})).toEqual({
      maxToolRounds: 6,
      maxHistoryMessages: 80,
      compactKeepMessages: 20,
      contextTokenLimit: 128_000
    });
  });

  it('uses lower default context limit for deepseek without a known model', () => {
    expect(resolveSessionSettings({}, 'deepseek').contextTokenLimit).toBe(64_000);
  });

  it('uses modelContextLimits for known model', () => {
    expect(resolveSessionSettings({
      modelContextLimits: { 'deepseek-v4-pro': 1_000_000 }
    }, 'deepseek', 'deepseek-v4-pro').contextTokenLimit).toBe(1_000_000);
  });

  it('applies overrides from .helix/config.json fields', () => {
    expect(resolveSessionSettings({
      maxToolRounds: 12,
      maxHistoryMessages: 50,
      compactKeepMessages: 10,
      contextTokenLimit: 32_000,
      modelContextLimits: { 'my-model': 256_000 }
    }, 'openai', 'my-model')).toEqual({
      maxToolRounds: 12,
      maxHistoryMessages: 50,
      compactKeepMessages: 10,
      contextTokenLimit: 256_000
    });
  });

  it('applies global contextTokenLimit when model is unknown', () => {
    expect(resolveSessionSettings({
      contextTokenLimit: 32_000
    }, 'openai', 'unknown')).toEqual({
      maxToolRounds: 6,
      maxHistoryMessages: 80,
      compactKeepMessages: 20,
      contextTokenLimit: 32_000
    });
  });
});
