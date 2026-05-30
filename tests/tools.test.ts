import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { readFileTool, searchFilesTool } from '../src/tools/filesystem.js';
import { classifyShellCommand } from '../src/tools/shell.js';

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
});

describe('shell safety', () => {
  it('blocks destructive commands', () => {
    expect(classifyShellCommand('git reset --hard').risk).toBe('blocked');
    expect(classifyShellCommand('rm -rf .').risk).toBe('blocked');
  });

  it('requires confirmation for ordinary commands', () => {
    expect(classifyShellCommand('npm test').risk).toBe('confirm');
  });
});
