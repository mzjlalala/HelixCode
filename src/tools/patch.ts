import { spawn } from 'node:child_process';

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
