import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd, windowsHide: true });
  return result.stdout;
}

export async function gitStatusTool(cwd: string): Promise<string> {
  return git(cwd, ['status', '--short']);
}

export async function gitDiffTool(cwd: string): Promise<string> {
  return git(cwd, ['diff']);
}
