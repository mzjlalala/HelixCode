import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { backupFile, loadUndoStack, undoLast } from '../src/tools/undo.js';

describe('undo persistence', () => {
  it('persists undo stack across loadUndoStack', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-undo-'));
    await writeFile(join(cwd, 'notes.txt'), 'original\n', 'utf8');

    await backupFile(cwd, 'notes.txt', 'write_file');
    await writeFile(join(cwd, 'notes.txt'), 'changed\n', 'utf8');

    const stackRaw = await readFile(join(cwd, '.helix', 'undo-stack.json'), 'utf8');
    expect(stackRaw).toContain('notes.txt');

    // Simulate process restart
    await loadUndoStack(cwd);
    const result = await undoLast(cwd);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry.path).toBe('notes.txt');
    }
    expect(await readFile(join(cwd, 'notes.txt'), 'utf8')).toBe('original\n');
  });
});
