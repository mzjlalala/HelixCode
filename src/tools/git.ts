/**
 * Git 工具：在工作区执行 git status / git diff，供 Agent 查看版本状态。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
  const result = await execFileAsync('git', args, { cwd, windowsHide: true, signal });
  return result.stdout;
}

/** 执行 git status --short */
export async function gitStatusTool(cwd: string, signal?: AbortSignal): Promise<string> {
  return git(cwd, ['status', '--short'], signal);
}

/** 执行 git diff（未暂存变更） */
export async function gitDiffTool(cwd: string, signal?: AbortSignal): Promise<string> {
  return git(cwd, ['diff'], signal);
}
