import { gitDiffTool, gitStatusTool } from '../tools/git.js';
import { readFileTool, searchFilesTool, listFilesTool } from '../tools/filesystem.js';
import { classifyShellCommand } from '../tools/shell.js';
import type { ChatMessage, ChatProvider } from '../llm/types.js';

export type AgentTurnResult =
  | { type: 'final'; message: string }
  | {
      type: 'confirmation';
      tool: 'run_shell' | 'write_file';
      args: Record<string, unknown>;
      summary: string;
    };

interface ToolRequest {
  tool: string;
  args?: Record<string, unknown>;
}

export class TerminalAgent {
  constructor(private readonly options: { cwd: string; provider: ChatProvider }) {}

  async run(input: string): Promise<AgentTurnResult> {
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: input }
    ];

    for (let i = 0; i < 6; i += 1) {
      const response = await this.options.provider.complete(messages);
      const request = parseToolRequest(response);

      if (!request) {
        return { type: 'final', message: response };
      }

      if (request.tool === 'run_shell') {
        const command = String(request.args?.command ?? '');
        const risk = classifyShellCommand(command);
        if (risk.risk === 'blocked') {
          return { type: 'final', message: risk.reason ?? 'Command blocked.' };
        }
        return {
          type: 'confirmation',
          tool: 'run_shell',
          args: { command },
          summary: `Run shell command: ${command}`
        };
      }

      if (request.tool === 'write_file') {
        return {
          type: 'confirmation',
          tool: 'write_file',
          args: request.args ?? {},
          summary: `Write file: ${String(request.args?.path ?? '')}`
        };
      }

      const observation = await this.executeTool(request);
      messages.push({ role: 'assistant', content: response });
      messages.push({ role: 'tool', content: observation });
    }

    return { type: 'final', message: 'HelixCode stopped after too many tool rounds.' };
  }

  private async executeTool(request: ToolRequest): Promise<string> {
    const args = request.args ?? {};

    if (request.tool === 'read_file') {
      return JSON.stringify(await readFileTool(this.options.cwd, { path: args.path }));
    }
    if (request.tool === 'search_files') {
      return JSON.stringify(await searchFilesTool(this.options.cwd, { query: args.query }));
    }
    if (request.tool === 'list_files') {
      return JSON.stringify(await listFilesTool(this.options.cwd));
    }
    if (request.tool === 'git_status') {
      return await gitStatusTool(this.options.cwd);
    }
    if (request.tool === 'git_diff') {
      return await gitDiffTool(this.options.cwd);
    }

    return JSON.stringify({ ok: false, error: `Unknown tool: ${request.tool}` });
  }
}

function parseToolRequest(text: string): ToolRequest | null {
  try {
    const parsed = JSON.parse(text) as Partial<ToolRequest>;
    if (typeof parsed.tool === 'string') {
      return { tool: parsed.tool, args: parsed.args ?? {} };
    }
  } catch {
    return null;
  }
  return null;
}

function systemPrompt(): string {
  return [
    'You are HelixCode, a terminal coding agent.',
    'Reply normally when you can answer.',
    'When you need a tool, reply with strict JSON like {"tool":"read_file","args":{"path":"README.md"}}.',
    'Available safe tools: read_file, list_files, search_files, git_status, git_diff.',
    'To write a file, use {"tool":"write_file","args":{"path":"path/to/file","content":"new content"}} and wait for user confirmation.',
    'For shell commands, use {"tool":"run_shell","args":{"command":"npm test"}} and wait for user confirmation.'
  ].join('\n');
}
