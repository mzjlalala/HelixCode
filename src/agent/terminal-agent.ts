import { gitDiffTool, gitStatusTool } from '../tools/git.js';
import { readFileTool, searchFilesTool, listFilesTool } from '../tools/filesystem.js';
import { classifyShellCommand } from '../tools/shell.js';
import type { ChatMessage, ChatProvider, ToolCall, ToolDefinition } from '../llm/types.js';
import type { ProjectInstruction } from '../core/config.js';

export type AgentTurnResult =
  | { type: 'final'; message: string }
  | {
      type: 'confirmation';
      tool: string;
      args: Record<string, unknown>;
      summary: string;
      tool_call_id: string;
    };

export type ConfirmedToolResult =
  | { ok: true; output: string }
  | { ok: false; error: string };

export type PlanItemStatus = 'pending' | 'in_progress' | 'completed';

export interface PlanItem {
  step: string;
  status: PlanItemStatus;
}

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read a project file, optionally by line range',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to project root' },
        startLine: { type: 'number', description: 'Optional start line (1-based)' },
        endLine: { type: 'number', description: 'Optional end line (inclusive)' }
      },
      required: ['path']
    }
  },
  {
    name: 'search_files',
    description: 'Search file contents with optional glob, case sensitivity, result limits, and context lines',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for' },
        glob: { type: 'string', description: 'Optional glob pattern (e.g. *.ts)' },
        caseSensitive: { type: 'boolean', description: 'Case sensitive search' },
        maxResults: { type: 'number', description: 'Maximum results to return' },
        contextLines: { type: 'number', description: 'Lines of context around each match' }
      },
      required: ['query']
    }
  },
  {
    name: 'list_files',
    description: 'List all project files (excluding .git, node_modules, dist)',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'git_status',
    description: 'Show git working tree status',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'git_diff',
    description: 'Show git diff (unstaged changes)',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'update_plan',
    description: 'Track multi-step work by setting plan items with pending/in_progress/completed status',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              step: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] }
            },
            required: ['step', 'status']
          }
        }
      },
      required: ['items']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a file (requires user confirmation)',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to project root' },
        content: { type: 'string', description: 'File content to write' }
      },
      required: ['path', 'content']
    },
    confirm: true
  },
  {
    name: 'replace_in_file',
    description: 'Replace exact text in a file (requires user confirmation)',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        oldText: { type: 'string', description: 'Exact text to replace' },
        newText: { type: 'string', description: 'Replacement text' },
        replaceAll: { type: 'boolean', description: 'Replace all occurrences' }
      },
      required: ['path', 'oldText', 'newText']
    },
    confirm: true
  },
  {
    name: 'edit_file',
    description: 'Replace an inclusive line range in a file (requires user confirmation)',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        startLine: { type: 'number' },
        endLine: { type: 'number' },
        content: { type: 'string', description: 'New content for the specified line range' }
      },
      required: ['path', 'startLine', 'endLine', 'content']
    },
    confirm: true
  },
  {
    name: 'apply_patch',
    description: 'Apply a unified diff patch to project files (requires user confirmation)',
    parameters: {
      type: 'object',
      properties: {
        patch: { type: 'string', description: 'Unified diff content' }
      },
      required: ['patch']
    },
    confirm: true
  },
  {
    name: 'run_shell',
    description: 'Run a shell command in the project directory (requires user confirmation)',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' }
      },
      required: ['command']
    },
    confirm: true
  }
];

const CONFIRMED_TOOLS = new Set(TOOL_DEFINITIONS.filter((t) => t.confirm).map((t) => t.name));

export class TerminalAgent {
  private readonly history: ChatMessage[] = [];
  private readonly plan: PlanItem[] = [];

  constructor(private readonly options: {
    cwd: string;
    provider: ChatProvider;
    projectInstructions?: ProjectInstruction[];
    onToken?: (token: string) => void;
    onReasoning?: (text: string) => void;
  }) {}

  async run(input: string, options?: { signal?: AbortSignal }): Promise<AgentTurnResult> {
    return this.completeTurn([{ role: 'user', content: input }], true, options?.signal);
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
        }),
        tool_call_id: confirmation.tool_call_id
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
        }),
        tool_call_id: confirmation.tool_call_id
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

  private async completeTurn(turnMessages: ChatMessage[], streamFirst = false, signal?: AbortSignal): Promise<AgentTurnResult> {
    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(this.options.projectInstructions ?? []) },
      ...this.history,
      ...turnMessages
    ];

    let isFirstTurn = streamFirst;

    for (let i = 0; i < 6; i += 1) {
      const result = await this.getLLMResponse(messages, isFirstTurn, signal);
      isFirstTurn = false;

      // Display reasoning if available (non-streaming path)
      if (result.reasoning_content && this.options.onReasoning) {
        this.options.onReasoning(result.reasoning_content);
      }

      // Native tool calls from the provider
      if (result.type === 'tool_calls') {
        const reasoningContent = result.reasoning_content ?? null;
        for (const call of result.calls) {
          turnMessages.push({
            role: 'assistant',
            content: result.content ?? null,
            tool_calls: [call],
            reasoning_content: reasoningContent
          });

          if (call.name === 'run_shell') {
            const command = String(call.arguments.command ?? '').trim();
            const risk = classifyShellCommand(command);
            if (risk.risk === 'blocked') {
              turnMessages.push({
                role: 'tool',
                content: JSON.stringify({ ok: false, error: risk.reason ?? 'Command blocked.' }),
                tool_call_id: call.id
              });
              this.appendHistory(turnMessages);
              return { type: 'final', message: risk.reason ?? 'Command blocked.' };
            }
            this.appendHistory(turnMessages);
            return {
              type: 'confirmation',
              tool: 'run_shell',
              args: { command },
              summary: `Run shell command: ${command}`,
              tool_call_id: call.id
            };
          }

          if (CONFIRMED_TOOLS.has(call.name)) {
            this.appendHistory(turnMessages);
            return {
              type: 'confirmation',
              tool: call.name,
              args: call.arguments,
              summary: toolSummary(call.name, call.arguments),
              tool_call_id: call.id
            };
          }

          // Safe tool — execute inline
          const observation = await this.executeTool(call);
          turnMessages.push({
            role: 'tool',
            content: observation,
            tool_call_id: call.id
          });
        }

        // Rebuild messages for next iteration
        messages.splice(
          0,
          messages.length,
          { role: 'system', content: buildSystemPrompt(this.options.projectInstructions ?? []) },
          ...this.history,
          ...turnMessages
        );
        continue;
      }

      // Text response — return as final
      turnMessages.push({ role: 'assistant', content: result.content, reasoning_content: result.reasoning_content ?? null });
      this.appendHistory(turnMessages);
      return { type: 'final', message: result.content };
    }

    this.appendHistory(turnMessages);
    return { type: 'final', message: 'HelixCode stopped after too many tool rounds.' };
  }

  private async getLLMResponse(
    messages: ChatMessage[],
    isFirstTurn: boolean,
    signal?: AbortSignal
  ): Promise<
    { type: 'text'; content: string; reasoning_content?: string | null }
    | { type: 'tool_calls'; calls: ToolCall[]; content?: string | null; reasoning_content?: string | null }
  > {
    if (isFirstTurn || !this.options.onToken || !this.options.provider.completeStream) {
      return this.options.provider.complete(messages, TOOL_DEFINITIONS);
    }
    return this.options.provider.completeStream(messages, this.options.onToken, { tools: TOOL_DEFINITIONS });
  }

  private async executeTool(call: ToolCall): Promise<string> {
    const args = call.arguments;

    if (call.name === 'read_file') {
      return JSON.stringify(await readFileTool(this.options.cwd, {
        path: args.path, startLine: args.startLine, endLine: args.endLine
      }));
    }
    if (call.name === 'search_files') {
      return JSON.stringify(await searchFilesTool(this.options.cwd, {
        query: args.query, glob: args.glob, caseSensitive: args.caseSensitive,
        maxResults: args.maxResults, contextLines: args.contextLines
      }));
    }
    if (call.name === 'list_files') {
      return JSON.stringify(await listFilesTool(this.options.cwd));
    }
    if (call.name === 'git_status') {
      return await gitStatusTool(this.options.cwd);
    }
    if (call.name === 'git_diff') {
      return await gitDiffTool(this.options.cwd);
    }
    if (call.name === 'update_plan') {
      return JSON.stringify(this.updatePlan(args));
    }

    return JSON.stringify({ ok: false, error: `Unknown tool: ${call.name}` });
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

function toolSummary(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'write_file': return `Write file: ${String(args.path ?? '')}`;
    case 'replace_in_file': return `Replace text in file: ${String(args.path ?? '')}`;
    case 'edit_file': return `Edit file: ${String(args.path ?? '')} lines ${String(args.startLine ?? '')}-${String(args.endLine ?? '')}`;
    case 'apply_patch': return 'Apply patch to project files';
    case 'run_shell': return `Run shell command: ${String(args.command ?? '')}`;
    default: return `Execute ${name}`;
  }
}

export function buildSystemPrompt(projectInstructions: ProjectInstruction[]): string {
  const lines = [
    'You are HelixCode, a terminal coding agent for local software projects.',
    'You are NOT Claude, NOT ChatGPT, and NOT an Anthropic product. You are HelixCode.',
    'Never mention Claude, Anthropic, OpenAI, or any other AI company name.',
    'When asked who you are, say "I am HelixCode, a terminal coding agent."',
    'Be concise, practical, and focused on completing the user request.',
    'Do NOT use Markdown formatting (**, ##, |table|, ---, `code`) in your responses.',
    'Output plain text suitable for terminal display. Use simple indentation for structure.',
    'Use the provided tools to inspect and modify the codebase.',
    'Reply normally when no tool is needed.',
    'Before editing, inspect the relevant files with read_file or search_files.',
    'Prefer search_files for finding code, symbols, or text across the project.',
    'Use update_plan for multi-step work, keeping exactly one item in_progress when a plan is useful.',
    'Make small, targeted edits that match the existing code style.',
    'Prefer replace_in_file for small exact edits, edit_file for line-range edits after reading line numbers, and apply_patch for larger multi-line edits.',
    'After changing code, run the smallest relevant verification command such as npm test, npm run typecheck, or npm run build.',
    'If a tool returns an error, read the error and recover instead of retrying the same invalid call.',
    'read_file accepts optional startLine and endLine. search_files accepts optional glob, caseSensitive, maxResults, and contextLines.',
    'Tools that modify files or run commands require user confirmation — wait for the result before continuing.'
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
