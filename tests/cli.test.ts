import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { handleSlashCommand } from '../src/cli/slash-commands.js';
import { createDoctorOutput, formatMissingApiKeyMessage, isMainModule, joinPromptArgs, parseMaxTurns } from '../src/cli/main.js';

describe('slash commands', () => {
  it('renders help', () => {
    const result = handleSlashCommand('/help');

    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.output).toContain('HelixCode');
      expect(result.output).toContain('/reset');
      expect(result.output).toContain('/history');
    }
  });

  it('recognizes exit commands', () => {
    const result = handleSlashCommand('/exit');

    expect(result.handled).toBe(true);
    if (result.handled) expect(result.exit).toBe(true);
  });

  it('renders status when context is provided', () => {
    const result = handleSlashCommand('/status', {
      cwd: 'D:/Code/HelixCode',
      model: 'gpt-test'
    });

    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.output).toContain('D:/Code/HelixCode');
      expect(result.output).toContain('gpt-test');
    }
  });

  it('renders and updates the active model', () => {
    const current = handleSlashCommand('/model', { model: 'gpt-test' });
    const updated = handleSlashCommand('/model gpt-4.1-mini', { model: 'gpt-test' });

    expect(current.handled).toBe(true);
    if (current.handled) expect(current.output).toBe('Current model: gpt-test');

    expect(updated.handled).toBe(true);
    if (updated.handled) {
      expect(updated.model).toBe('gpt-4.1-mini');
      expect(updated.output).toBe('Model set to gpt-4.1-mini');
    }
  });

  it('renders doctor diagnostics from context', () => {
    const result = handleSlashCommand('/doctor', {
      cwd: 'D:/Code/HelixCode',
      model: 'gpt-test',
      apiKeyConfigured: true,
      baseURL: 'https://example.test/v1',
      projectInstructions: ['AGENTS.md'],
      historyMessages: 3,
      planItems: [{ step: 'Check state', status: 'completed' }]
    });

    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.output).toContain('HelixCode doctor:');
      expect(result.output).toContain('cwd: D:/Code/HelixCode');
      expect(result.output).toContain('model: gpt-test');
      expect(result.output).toContain('api key: set');
      expect(result.output).toContain('project instructions: AGENTS.md');
    }
  });

  it('renders history count from context', () => {
    const result = handleSlashCommand('/history', { historyMessages: 7 });

    expect(result.handled).toBe(true);
    if (result.handled) expect(result.output).toBe('Session history messages: 7');
  });

  it('renders the current plan from context', () => {
    const result = handleSlashCommand('/plan', {
      planItems: [
        { step: 'Inspect files', status: 'completed' },
        { step: 'Implement change', status: 'in_progress' }
      ]
    });

    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.output).toContain('[done] Inspect files');
      expect(result.output).toContain('[active] Implement change');
    }
  });

  it('recognizes reset as a context-clearing command without clearing the screen', () => {
    const result = handleSlashCommand('/reset');

    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.clear).toBe(false);
      expect(result.reset).toBe(true);
      expect(result.output).toBe('Session context reset.');
    }
  });

  it('recognizes compact as a history-compacting command', () => {
    const result = handleSlashCommand('/compact', {
      historyMessages: 42,
      compactedHistoryMessages: 20
    });

    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.compact).toBe(true);
      expect(result.output).toBe('Session history compacted from 42 to 20 messages.');
    }
  });
});

describe('one-shot prompt helpers', () => {
  it('joins prompt arguments into one task', () => {
    expect(joinPromptArgs(['fix', 'the', 'tests'])).toBe('fix the tests');
    expect(joinPromptArgs([])).toBe('');
  });

  it('parses max turns with a safe default', () => {
    expect(parseMaxTurns('3')).toBe(3);
    expect(parseMaxTurns('0')).toBe(10);
    expect(parseMaxTurns(undefined)).toBe(10);
  });
});
describe('CLI entry detection', () => {
  it('recognizes the bundled entry file on Windows-compatible paths', async () => {
    const file = 'D:/Code/HelixCode/dist/main.js';

    await expect(isMainModule(pathToFileURL(file).href, file)).resolves.toBe(true);
  });

  it('recognizes globally linked entry shims by real path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'helix-entry-'));
    const realDir = join(dir, 'real');
    const linkedDir = join(dir, 'linked');
    await mkdir(realDir);
    const target = join(realDir, 'main.js');
    const linked = join(linkedDir, 'main.js');
    await writeFile(target, 'console.log("helix")\n', 'utf8');
    await symlink(realDir, linkedDir, 'junction');

    await expect(isMainModule(pathToFileURL(target).href, linked)).resolves.toBe(true);
  });
});

describe('CLI configuration guidance', () => {
  it('renders setup guidance when the API key is missing', () => {
    const message = formatMissingApiKeyMessage();

    expect(message).toContain('HELIX_API_KEY is not set');
    expect(message).toContain('$env:HELIX_API_KEY');
    expect(message).toContain('OPENAI_API_KEY');
  });

  it('renders doctor output without requiring an API key', async () => {
    const previousHelixKey = process.env.HELIX_API_KEY;
    const previousOpenAIKey = process.env.OPENAI_API_KEY;
    const previousDeepSeekKey = process.env.DEEPSEEK_API_KEY;
    delete process.env.HELIX_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;

    try {
      const output = await createDoctorOutput(process.cwd());

      expect(output).toContain('HelixCode doctor:');
      expect(output).toContain('cwd:');
      expect(output).toContain('model:');
      expect(output).toContain('base URL:');
      expect(output).toContain('api key: missing');
      expect(output).toContain('node:');
    } finally {
      if (previousHelixKey === undefined) delete process.env.HELIX_API_KEY;
      else process.env.HELIX_API_KEY = previousHelixKey;
      if (previousOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAIKey;
      if (previousDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previousDeepSeekKey;
    }
  });
});
