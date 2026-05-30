import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { readFileTool, searchFilesTool, writeFileTool } from '../src/tools/filesystem.js';
import { applyPatchTool } from '../src/tools/patch.js';
import { classifyShellCommand, runShellCommand } from '../src/tools/shell.js';

async function makeProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'helixcode-'));
  await writeFile(join(root, 'README.md'), '# HelixCode\nterminal agent\n', 'utf8');
  await writeFile(join(root, 'index.ts'), 'export const name = "HelixCode";\n', 'utf8');
  return root;
}

describe('filesystem tools', () => {
  it('reads files inside the project root', async () => {
    const cwd = await makeProject();

    const result = await readFileTool(cwd, { path: 'README.md' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toContain('terminal agent');
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
    }
  });

  it('requires confirmation for ordinary commands', () => {
    expect(classifyShellCommand('npm test').risk).toBe('confirm');
  });
});
