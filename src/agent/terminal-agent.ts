import { gitDiffTool, gitStatusTool } from '../tools/git.js';
import { readFileTool, searchFilesTool, listFilesTool } from '../tools/filesystem.js';
import { classifyShellCommand } from '../tools/shell.js';
import type { ChatMessage, ChatProvider } from '../llm/types.js';

export type AgentTurnResult =
  | { type: 'final'; message: string }
  | {
      type: 'confirmation';
      tool: 'run_shell' | 'write_file' | 'apply_patch';
      args: Record<string, unknown>;
      summary: string;
    };

export type ConfirmedToolResult =
  | { ok: true; output: string }
  | { ok: false; error: string };

interface ToolRequest {
  tool: string;
  args?: Record<string, unknown>;
}

export class TerminalAgent {
  private readonly history: ChatMessage[] = [];

  constructor(private readonly options: { cwd: string; provider: ChatProvider }) {}

  async run(input: string): Promise<AgentTurnResult> {
    return this.completeTurn([{ role: 'user', content: input }]);
  }

  async continueAfterConfirmation(
    confirmation: Extract<AgentTurnResult, { type: 'confirmation' }>,
    result: ConfirmedToolResult
  ): Promise<AgentTurnResult> {
    return this.completeTurn([
      {
        role: 'tool',
        content: JSON.stringify({
          confirmedTool: confirmation.tool,
          args: confirmation.args,
          result
        })
      }
    ]);
  }

  recordSkippedConfirmation(
    confirmation: Extract<AgentTurnResult, { type: 'confirmation' }>
  ): void {
    this.appendHistory([
      {
        role: 'tool',
        content: JSON.stringify({
          confirmedTool: confirmation.tool,
          args: confirmation.args,
          result: { ok: false, error: 'User skipped this action.' }
        })
      }
    ]);
  }

  clearHistory(): void {
    this.history.splice(0, this.history.length);
  }

  historySize(): number {
    return this.history.length;
  }

  private async completeTurn(turnMessages: ChatMessage[]): Promise<AgentTurnResult> {
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt() },
      ...this.history,
      ...turnMessages
    ];

    for (let i = 0; i < 6; i += 1) {
      const response = await this.options.provider.complete(messages);
      const request = parseToolRequest(response);

      if (!request) {
        turnMessages.push({ role: 'assistant', content: response });
        this.appendHistory(turnMessages);
        return { type: 'final', message: response };
      }

      turnMessages.push({ role: 'assistant', content: response });

      if (request.tool === 'run_shell') {
        const command = String(request.args?.command ?? '');
        const risk = classifyShellCommand(command);
        if (risk.risk === 'blocked') {
          turnMessages.push({
            role: 'tool',
            content: JSON.stringify({ ok: false, error: risk.reason ?? 'Command blocked.' })
          });
          this.appendHistory(turnMessages);
          return { type: 'final', message: risk.reason ?? 'Command blocked.' };
        }
        this.appendHistory(turnMessages);
        return {
          type: 'confirmation',
          tool: 'run_shell',
          args: { command },
          summary: `Run shell command: ${command}`
        };
      }

      if (request.tool === 'write_file') {
        this.appendHistory(turnMessages);
        return {
          type: 'confirmation',
          tool: 'write_file',
          args: request.args ?? {},
          summary: `Write file: ${String(request.args?.path ?? '')}`
        };
      }

      if (request.tool === 'apply_patch') {
        this.appendHistory(turnMessages);
        return {
          type: 'confirmation',
          tool: 'apply_patch',
          args: request.args ?? {},
          summary: 'Apply patch to project files'
        };
      }

      const observation = await this.executeTool(request);
      turnMessages.push({ role: 'tool', content: observation });
      messages.splice(
        0,
        messages.length,
        { role: 'system', content: systemPrompt() },
        ...this.history,
        ...turnMessages
      );
    }

    this.appendHistory(turnMessages);
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

  private appendHistory(messages: ChatMessage[]): void {
    this.history.push(...messages);
    const maxMessages = 80;
    if (this.history.length > maxMessages) {
      this.history.splice(0, this.history.length - maxMessages);
    }
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
    'To edit existing files with a patch, use {"tool":"apply_patch","args":{"patch":"unified diff content"}} and wait for user confirmation.',
    'For shell commands, use {"tool":"run_shell","args":{"command":"npm test"}} and wait for user confirmation.'
  ].join('\n');
}
