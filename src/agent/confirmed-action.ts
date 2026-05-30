import type { AgentTurnResult } from './terminal-agent.js';
import { writeFileTool } from '../tools/filesystem.js';
import { runShellCommand } from '../tools/shell.js';

export async function executeConfirmedTool(
  cwd: string,
  confirmation: Extract<AgentTurnResult, { type: 'confirmation' }>
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  if (confirmation.tool === 'write_file') {
    const result = await writeFileTool(cwd, {
      path: confirmation.args.path,
      content: confirmation.args.content
    });
    if (!result.ok) return result;
    return { ok: true, output: `Wrote ${result.path}` };
  }

  const command = String(confirmation.args.command ?? '');
  const result = await runShellCommand(cwd, command);
  if (!result.ok) return result;
  return {
    ok: true,
    output: [result.stdout, result.stderr].filter(Boolean).join('\n')
  };
}
