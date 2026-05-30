import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { handleSlashCommand } from '../src/cli/slash-commands.js';
import { formatMissingApiKeyMessage, isMainModule } from '../src/cli/main.js';

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
    const result = handleSlashCommand('/compact', { compactedHistoryMessages: 20 });

    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.compact).toBe(true);
      expect(result.output).toBe('Session history compacted to 20 messages.');
    }
  });
});

describe('CLI entry detection', () => {
  it('recognizes the bundled entry file on Windows-compatible paths', () => {
    const file = 'D:/Code/HelixCode/dist/main.js';

    expect(isMainModule(pathToFileURL(file).href, file)).toBe(true);
  });
});

describe('CLI configuration guidance', () => {
  it('renders setup guidance when the API key is missing', () => {
    const message = formatMissingApiKeyMessage();

    expect(message).toContain('HELIX_API_KEY is not set');
    expect(message).toContain('$env:HELIX_API_KEY');
    expect(message).toContain('OPENAI_API_KEY');
  });
});
