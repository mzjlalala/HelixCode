import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface ShellRisk {
  risk: 'confirm' | 'blocked';
  reason?: string;
}

export function classifyShellCommand(command: string): ShellRisk {
  const destructivePatterns = [
    /\brm\s+-rf\b/i,
    /\bgit\s+reset\s+--hard\b/i,
    /\bgit\s+clean\s+-fd\b/i,
    /\bdel\s+\/[sq]\b/i,
    /\brmdir\s+\/s\b/i,
    /\bformat\b/i,
    /\bdiskpart\b/i
  ];

  if (destructivePatterns.some((pattern) => pattern.test(command))) {
    return { risk: 'blocked', reason: 'Destructive command blocked by HelixCode.' };
  }

  return { risk: 'confirm' };
}

export async function runShellCommand(
  cwd: string,
  command: string
): Promise<{ ok: true; stdout: string; stderr: string; exitCode: number } | { ok: false; error: string }> {
  const safety = classifyShellCommand(command);
  if (safety.risk === 'blocked') {
    return { ok: false, error: safety.reason ?? 'Command blocked.' };
  }

  try {
    const result = await execAsync(command, { cwd, windowsHide: true });
    return { ok: true, stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      ok: true,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.message ?? '',
      exitCode: typeof err.code === 'number' ? err.code : 1
    };
  }
}
