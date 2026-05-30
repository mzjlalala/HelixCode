import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { handleSlashCommand } from '../src/cli/slash-commands.js';
import { isMainModule } from '../src/cli/main.js';

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

  it('recognizes reset as a context-clearing command without clearing the screen', () => {
    const result = handleSlashCommand('/reset');

    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.clear).toBe(false);
      expect(result.reset).toBe(true);
      expect(result.output).toBe('Session context reset.');
    }
  });
});

describe('CLI entry detection', () => {
  it('recognizes the bundled entry file on Windows-compatible paths', () => {
    const file = 'D:/Code/HelixCode/dist/main.js';

    expect(isMainModule(pathToFileURL(file).href, file)).toBe(true);
  });
});
