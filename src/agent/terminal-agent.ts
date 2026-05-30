import { gitDiffTool, gitStatusTool } from '../tools/git.js';
import { readFileTool, searchFilesTool, listFilesTool } from '../tools/filesystem.js';
import { classifyShellCommand } from '../tools/shell.js';
import type { ChatMessage, ChatProvider } from '../llm/types.js';
import { parseToolRequest, type ToolRequest } from './tool-request.js';
import type { ProjectInstruction } from '../core/config.js';

export type AgentTurnResult =
  | { type: 'final'; message: string }
  | {
      type: 'confirmation';
      tool: 'run_shell' | 'write_file' | 'apply_patch' | 'replace_in_file' | 'edit_file';
      args: Record<string, unknown>;
      summary: string;
    };

export type ConfirmedToolResult =
  | { ok: true; output: string }
  | { ok: false; error: string };

export type PlanItemStatus = 'pending' | 'in_progress' | 'completed';

export interface PlanItem {
  step: string;
  status: PlanItemStatus;
}

export class TerminalAgent {
  private readonly history: ChatMessage[] = [];
  private readonly plan: PlanItem[] = [];

  constructor(private readonly options: {
    cwd: string;
    provider: ChatProvider;
    projectInstructions?: ProjectInstruction[];
  }) {}

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

  compactHistory(keepMessages = 20): number {
    const keep = Math.max(0, Math.floor(keepMessages));
    if (this.history.length > keep) {
      this.history.splice(0, this.history.length - keep);
    }
    return this.history.length;
  }

  currentPlan(): PlanItem[] {
    return this.plan.map((item) => ({ ...item }));
  }

  private async completeTurn(turnMessages: ChatMessage[]): Promise<AgentTurnResult> {
    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(this.options.projectInstructions ?? []) },
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
        const command = String(request.args?.command ?? '').trim();
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

      if (request.tool === 'replace_in_file') {
        this.appendHistory(turnMessages);
        return {
          type: 'confirmation',
          tool: 'replace_in_file',
          args: request.args ?? {},
          summary: `Replace text in file: ${String(request.args?.path ?? '')}`
        };
      }

      if (request.tool === 'edit_file') {
        this.appendHistory(turnMessages);
        return {
          type: 'confirmation',
          tool: 'edit_file',
          args: request.args ?? {},
          summary: `Edit file: ${String(request.args?.path ?? '')} lines ${String(request.args?.startLine ?? '')}-${String(request.args?.endLine ?? '')}`
        };
      }

      const observation = await this.executeTool(request);
      turnMessages.push({ role: 'tool', content: observation });
      messages.splice(
        0,
        messages.length,
        { role: 'system', content: buildSystemPrompt(this.options.projectInstructions ?? []) },
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
      return JSON.stringify(await readFileTool(this.options.cwd, {
        path: args.path,
        startLine: args.startLine,
        endLine: args.endLine
      }));
    }
    if (request.tool === 'search_files') {
      return JSON.stringify(await searchFilesTool(this.options.cwd, {
        query: args.query,
        glob: args.glob,
        caseSensitive: args.caseSensitive,
        maxResults: args.maxResults,
        contextLines: args.contextLines
      }));
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
    if (request.tool === 'update_plan') {
      return JSON.stringify(this.updatePlan(request.args));
    }

    return JSON.stringify({ ok: false, error: `Unknown tool: ${request.tool}` });
  }

  private updatePlan(args: Record<string, unknown>): { ok: true; plan: PlanItem[] } | { ok: false; error: string } {
    if (!Array.isArray(args.items)) {
      return { ok: false, error: 'update_plan requires an items array.' };
    }
    const nextPlan: PlanItem[] = [];
    for (const item of args.items) {
      if (!isPlanItem(item)) {
        return { ok: false, error: 'Each plan item requires step and valid status.' };
      }
      nextPlan.push({ step: item.step, status: item.status });
    }
    this.plan.splice(0, this.plan.length, ...nextPlan);
    return { ok: true, plan: this.currentPlan() };
  }

  private appendHistory(messages: ChatMessage[]): void {
    this.history.push(...messages);
    const maxMessages = 80;
    if (this.history.length > maxMessages) {
      this.history.splice(0, this.history.length - maxMessages);
    }
  }
}

export function buildSystemPrompt(projectInstructions: ProjectInstruction[]): string {
  const lines = [
    'You are HelixCode, a terminal coding agent for local software projects.',
    'Be concise, practical, and focused on completing the user request.',
    'Reply normally when no tool is needed.',
    'Reply with exactly one JSON object when calling a tool. Do not wrap tool JSON in prose or Markdown.',
    'Tool call shape: {"tool":"read_file","args":{"path":"README.md"}}.',
    'Available safe tools: read_file, list_files, search_files, git_status, git_diff, update_plan.',
    'Available confirmed tools: write_file, replace_in_file, edit_file, apply_patch, run_shell.',
    'Before editing, inspect the relevant files with read_file or search_files.',
    'Prefer search_files for finding code, symbols, or text across the project.',
    'Use update_plan for multi-step work, keeping exactly one item in_progress when a plan is useful.',
    'Make small, targeted edits that match the existing code style.',
    'Prefer replace_in_file for small exact edits, edit_file for line-range edits after reading line numbers, and apply_patch for larger multi-line edits.',
    'After changing code, run the smallest relevant verification command such as npm test, npm run typecheck, or npm run build.',
    'If a tool returns an error, read the error and recover instead of retrying the same invalid call.',
    'read_file accepts optional startLine and endLine. search_files accepts optional glob, caseSensitive, maxResults, and contextLines.',
    'To write a file, use {"tool":"write_file","args":{"path":"path/to/file","content":"new content"}} and wait for user confirmation.',
    'To replace exact text in a file, use {"tool":"replace_in_file","args":{"path":"path/to/file","oldText":"old","newText":"new"}} and wait for user confirmation. Set replaceAll true only when every match should change.',
    'To edit existing files with a patch, use {"tool":"apply_patch","args":{"patch":"unified diff content"}} and wait for user confirmation.',
    'For shell commands, use {"tool":"run_shell","args":{"command":"npm test"}} and wait for user confirmation.'
  ];

  for (const instruction of projectInstructions) {
    lines.push('', `Project instructions from ${instruction.path}:`, instruction.content.trimEnd());
  }

  return lines.join('\n');
}

function isPlanItem(value: unknown): value is PlanItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as { step?: unknown; status?: unknown };
  return typeof item.step === 'string' && item.step.trim().length > 0 && isPlanStatus(item.status);
}

function isPlanStatus(value: unknown): value is PlanItemStatus {
  return value === 'pending' || value === 'in_progress' || value === 'completed';
}
