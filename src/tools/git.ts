import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
  const result = await execFileAsync('git', args, { cwd, windowsHide: true, signal });
  return result.stdout;
}

export async function gitStatusTool(cwd: string, signal?: AbortSignal): Promise<string> {
  return git(cwd, ['status', '--short'], signal);
}

export async function gitDiffTool(cwd: string, signal?: AbortSignal): Promise<string> {
  return git(cwd, ['diff'], signal);
}
