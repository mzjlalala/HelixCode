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
    /\bdiskpart\b/i,
    /\bcurl\s+[^\n|]*\|\s*(ba)?sh\b/i,
    /\bwget\s+[^\n|]*\|\s*(ba)?sh\b/i,
    /\bpowershell\s+-(?:enc|e)\b/i
  ];

  if (destructivePatterns.some((pattern) => pattern.test(command))) {
    return { risk: 'blocked', reason: 'Destructive command blocked by HelixCode.' };
  }

  return { risk: 'confirm' };
}

const SHELL_TIMEOUT_MS = 120_000;
const SHELL_MAX_BUFFER = 10 * 1024 * 1024;

export async function runShellCommand(
  cwd: string,
  command: string
): Promise<{ ok: true; stdout: string; stderr: string; exitCode: number } | { ok: false; error: string }> {
  const safety = classifyShellCommand(command);
  if (safety.risk === 'blocked') {
    return { ok: false, error: safety.reason ?? 'Command blocked.' };
  }

  try {
    const result = await execAsync(command, {
      cwd,
      windowsHide: true,
      timeout: SHELL_TIMEOUT_MS,
      maxBuffer: SHELL_MAX_BUFFER
    });
    return { ok: true, stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number; killed?: boolean; message?: string };
    return { ok: false, error: formatShellFailure(command, err) };
  }
}

function formatShellFailure(
  command: string,
  error: {
    stdout?: string;
    stderr?: string;
    code?: number;
    killed?: boolean;
    message?: string;
  }
): string {
  const exitCode = typeof error.code === 'number' ? error.code : 1;
  let lines: string[];
  if (error.killed) {
    lines = [`Command timed out after ${SHELL_TIMEOUT_MS / 1000}s: ${command}`];
  } else {
    lines = [`Command failed (exit code ${exitCode}): ${command}`];
  }
  if (error.stdout) lines.push(`stdout:\n${error.stdout.trimEnd()}`);
  if (error.stderr) {
    lines.push(`stderr:\n${error.stderr.trimEnd()}`);
  } else if (error.message && !error.killed) {
    lines.push(`stderr:\n${error.message}`);
  }
  return lines.join('\n');
}
