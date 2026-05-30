import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  editFileTool,
  readFileTool,
  replaceInFileTool,
  searchFilesTool,
  writeFileTool
} from '../src/tools/filesystem.js';
import { applyPatchTool } from '../src/tools/patch.js';
import { classifyShellCommand, runShellCommand } from '../src/tools/shell.js';

async function makeProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'helixcode-'));
  await writeFile(join(root, 'README.md'), '# HelixCode\nterminal agent\n', 'utf8');
  await writeFile(join(root, 'index.ts'), 'export const name = "HelixCode";\n', 'utf8');
  await writeFile(join(root, 'notes.test.ts'), 'HelixCode test helper\n', 'utf8');
  return root;
}

describe('filesystem tools', () => {
  it('reads files inside the project root', async () => {
    const cwd = await makeProject();

    const result = await readFileTool(cwd, { path: 'README.md' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toContain('terminal agent');
  });

  it('reads a requested line range', async () => {
    const cwd = await makeProject();
    await writeFile(join(cwd, 'lines.txt'), 'one\ntwo\nthree\nfour\n', 'utf8');

    const result = await readFileTool(cwd, { path: 'lines.txt', startLine: 2, endLine: 3 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toBe('two\nthree\n');
  });

  it('rejects path traversal', async () => {
    const cwd = await makeProject();

    const result = await readFileTool(cwd, { path: '../secrets.txt' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/outside project/i);
  });

  it('searches project files', async () => {
    const cwd = await makeProject();

    const result = await searchFilesTool(cwd, { query: 'HelixCode' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.matches.map((m) => m.path)).toContain('README.md');
  });

  it('searches with glob, case sensitivity, limits, and context lines', async () => {
    const cwd = await makeProject();

    const result = await searchFilesTool(cwd, {
      query: 'HelixCode',
      glob: '*.md',
      caseSensitive: true,
      maxResults: 1,
      contextLines: 1
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]).toEqual({
        path: 'README.md',
        line: 1,
        text: '# HelixCode',
        before: [],
        after: ['terminal agent']
      });
    }
  });

  it('writes files inside the project root', async () => {
    const cwd = await makeProject();

    const result = await writeFileTool(cwd, {
      path: 'notes/result.txt',
      content: 'created by HelixCode\n'
    });

    expect(result.ok).toBe(true);
    await expect(readFile(join(cwd, 'notes/result.txt'), 'utf8')).resolves.toContain(
      'created by HelixCode'
    );
  });

  it('replaces exact text inside a file', async () => {
    const cwd = await makeProject();

    const result = await replaceInFileTool(cwd, {
      path: 'README.md',
      oldText: 'terminal agent',
      newText: 'terminal coding agent'
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.replacements).toBe(1);
    await expect(readFile(join(cwd, 'README.md'), 'utf8')).resolves.toContain(
      'terminal coding agent'
    );
  });

  it('explains missing replace text with recovery guidance', async () => {
    const cwd = await makeProject();

    const result = await replaceInFileTool(cwd, {
      path: 'README.md',
      oldText: 'missing phrase',
      newText: 'replacement'
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('README.md');
      expect(result.error).toContain('missing phrase');
      expect(result.error).toMatch(/whitespace\/casing|read the file again/i);
    }
  });
  it('edits a file by replacing an inclusive line range', async () => {
    const cwd = await makeProject();
    await writeFile(join(cwd, 'lines.txt'), 'one\ntwo\nthree\nfour\n', 'utf8');

    const result = await editFileTool(cwd, {
      path: 'lines.txt',
      startLine: 2,
      endLine: 3,
      content: 'TWO\nTHREE'
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.linesChanged).toBe(2);
    await expect(readFile(join(cwd, 'lines.txt'), 'utf8')).resolves.toBe('one\nTWO\nTHREE\nfour\n');
  });

  it('rejects invalid edit line ranges', async () => {
    const cwd = await makeProject();

    const result = await editFileTool(cwd, {
      path: 'README.md',
      startLine: 3,
      endLine: 2,
      content: 'bad'
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/endLine/i);
  });
});

describe('patch tools', () => {
  it('applies unified diffs inside the project', async () => {
    const cwd = await makeProject();

    const result = await applyPatchTool(cwd, {
      patch: [
        'diff --git a/README.md b/README.md',
        '--- a/README.md',
        '+++ b/README.md',
        '@@ -1,2 +1,2 @@',
        ' # HelixCode',
        '-terminal agent',
        '+terminal coding agent',
        ''
      ].join('\n')
    });

    expect(result.ok).toBe(true);
    await expect(readFile(join(cwd, 'README.md'), 'utf8')).resolves.toContain(
      'terminal coding agent'
    );
  });

  it('rejects patch paths outside the project', async () => {
    const cwd = await makeProject();

    const result = await applyPatchTool(cwd, {
      patch: [
        'diff --git a/README.md b/../README.md',
        '--- a/README.md',
        '+++ b/../README.md',
        '@@ -1,2 +1,2 @@',
        ' # HelixCode',
        '-terminal agent',
        '+terminal coding agent',
        ''
      ].join('\n')
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/outside the project/i);
  });
});

describe('shell safety', () => {
  it('blocks destructive commands', () => {
    expect(classifyShellCommand('git reset --hard').risk).toBe('blocked');
    expect(classifyShellCommand('rm -rf .').risk).toBe('blocked');
  });

  it('rejects empty shell commands', async () => {
    const cwd = await makeProject();

    const result = await runShellCommand(cwd, '   ');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/non-empty command/i);
  });

  it('reports non-zero shell exit codes as failures', async () => {
    const cwd = await makeProject();
    const command = `"${process.execPath}" -e "console.log('shell out'); console.error('shell err'); process.exit(3)"`;

    const result = await runShellCommand(cwd, command);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('exit code 3');
      expect(result.error).toContain('shell out');
      expect(result.error).toContain('shell err');
      expect(result.error).toContain(command.slice(0, 20));
    }
  });

  it('requires confirmation for ordinary commands', () => {
    expect(classifyShellCommand('npm test').risk).toBe('confirm');
  });
});
