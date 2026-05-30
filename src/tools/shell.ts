import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface ShellRisk {
  risk: 'confirm' | 'blocked';
  reason?: string;
}

export function classifyShellCommand(command: string): ShellRisk {
  if (!command.trim()) {
    return { risk: 'blocked', reason: 'run_shell requires a non-empty command.' };
  }

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
    return { ok: false, error: formatShellFailure(err) };
  }
}

function formatShellFailure(error: {
  stdout?: string;
  stderr?: string;
  code?: number;
  message?: string;
}): string {
  const exitCode = typeof error.code === 'number' ? error.code : 1;
  const lines = [`Command exited with exit code ${exitCode}.`];
  if (error.stdout) lines.push(`stdout:\n${error.stdout.trimEnd()}`);
  if (error.stderr) {
    lines.push(`stderr:\n${error.stderr.trimEnd()}`);
  } else if (error.message) {
    lines.push(`stderr:\n${error.message}`);
  }
  return lines.join('\n');
}
