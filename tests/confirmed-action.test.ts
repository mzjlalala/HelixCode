import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { previewConfirmedTool } from '../src/agent/confirmed-action.js';
import { createDefaultRegistry } from '../src/tools/registry.js';

const registry = createDefaultRegistry();

describe('confirmed action previews', () => {
  it('previews write_file overwrite actions with a compact diff', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-preview-'));
    await writeFile(join(cwd, 'README.md'), 'old line\nkept\n', 'utf8');

    const preview = await previewConfirmedTool(cwd, {
      type: 'confirmation',
      tool: 'write_file',
      args: { path: 'README.md', content: 'new line\nkept\n' },
      summary: 'Write file: README.md',
      tool_call_id: 'test'
    }, registry);

    expect(preview).toContain('README.md');
    expect(preview).toContain('-old line');
    expect(preview).toContain('+new line');
  });

  it('previews apply_patch actions with affected files', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-preview-'));

    const preview = await previewConfirmedTool(cwd, {
      type: 'confirmation',
      tool: 'apply_patch',
      args: {
        patch: [
          'diff --git a/README.md b/README.md',
          '--- a/README.md',
          '+++ b/README.md',
          '@@ -1 +1 @@',
          '-old',
          '+new',
          ''
        ].join('\n')
      },
      summary: 'Apply patch to project files',
      tool_call_id: 'test'
    }, registry);

    expect(preview).toContain('README.md');
    expect(preview).toContain('-old');
    expect(preview).toContain('+new');
  });

  it('previews replace_in_file actions with a compact diff', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-preview-'));
    await writeFile(join(cwd, 'README.md'), 'old line\nkept\n', 'utf8');

    const preview = await previewConfirmedTool(cwd, {
      type: 'confirmation',
      tool: 'replace_in_file',
      args: { path: 'README.md', oldText: 'old line', newText: 'new line' },
      summary: 'Replace text in file: README.md',
      tool_call_id: 'test'
    }, registry);

    expect(preview).toContain('README.md');
    expect(preview).toContain('-old line');
    expect(preview).toContain('+new line');
  });

  it('previews edit_file actions with a compact diff', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-preview-'));
    await writeFile(join(cwd, 'README.md'), 'one\ntwo\nthree\n', 'utf8');

    const preview = await previewConfirmedTool(cwd, {
      type: 'confirmation',
      tool: 'edit_file',
      args: { path: 'README.md', startLine: 2, endLine: 2, content: 'TWO' },
      summary: 'Edit file: README.md lines 2-2',
      tool_call_id: 'test'
    }, registry);

    expect(preview).toContain('README.md');
    expect(preview).toContain('-two');
    expect(preview).toContain('+TWO');
  });

  it('previews run_shell actions with the command and risk', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-preview-'));

    const preview = await previewConfirmedTool(cwd, {
      type: 'confirmation',
      tool: 'run_shell',
      args: { command: 'npm test' },
      summary: 'Run shell command: npm test',
      tool_call_id: 'test'
    }, registry);

    expect(preview).toContain('npm test');
    expect(preview).toMatch(/confirm|confirmation/);
  });
});
