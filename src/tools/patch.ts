/**
 * 补丁工具：通过 git apply 应用统一 diff，并校验补丁路径不逃出项目根目录。
 */

import { spawn } from 'node:child_process';

/** 先 git apply --check，通过后再应用统一 diff */
export async function applyPatchTool(
  cwd: string,
  args: { patch?: unknown }
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  if (typeof args.patch !== 'string' || !args.patch.trim()) {
    return { ok: false, error: 'apply_patch requires a non-empty patch string.' };
  }
  const unsafePath = findUnsafePatchPath(args.patch);
  if (unsafePath) {
    return { ok: false, error: `Patch path is outside the project: ${unsafePath}` };
  }

  // 干跑校验，避免应用半截失败
  const check = await runGitApply(cwd, args.patch, ['apply', '--check', '--whitespace=nowarn', '-']);
  if (!check.ok) return check;

  return runGitApply(cwd, args.patch, ['apply', '--whitespace=nowarn', '-']);
}

function runGitApply(
  cwd: string,
  patch: string,
  args: string[]
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => resolve({ ok: false, error: error.message }));
    child.on('close', (code) => {
      const output = Buffer.concat(stdout).toString('utf8').trim();
      const error = Buffer.concat(stderr).toString('utf8').trim();
      if (code === 0) {
        resolve({ ok: true, output: output || 'Patch applied.' });
      } else {
        resolve({ ok: false, error: error || `git apply exited with ${code ?? 'unknown'}.` });
      }
    });

    child.stdin.end(patch);
  });
}

/** 检查补丁头中的路径是否指向项目外或含 .. */
function findUnsafePatchPath(patch: string): string | null {
  for (const line of patch.split(/\r?\n/)) {
    const paths = patchHeaderPaths(line);
    for (const item of paths) {
      const normalized = item.replace(/^"|"$/g, '').replace(/^[ab]\//, '');
      if (
        normalized.startsWith('/') ||
        /^[A-Za-z]:/.test(normalized) ||
        normalized.includes('\\') ||
        normalized.split('/').includes('..')
      ) {
        return item;
      }
    }
  }
  return null;
}

function patchHeaderPaths(line: string): string[] {
  if (line.startsWith('diff --git ')) {
    return line.slice('diff --git '.length).split(/\s+/).filter(Boolean);
  }
  if (line.startsWith('--- ') || line.startsWith('+++ ')) {
    const item = line.slice(4).split(/\s+/)[0];
    return item && item !== '/dev/null' ? [item] : [];
  }
  return [];
}
