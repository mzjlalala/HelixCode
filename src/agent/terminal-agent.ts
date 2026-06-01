import { classifyShellCommand } from '../tools/shell.js';
import { createDefaultRegistry, ToolRegistry } from '../tools/registry.js';
import type { ChatMessage, ChatProvider, ToolCall } from '../llm/types.js';
import { parseToolRequest } from './tool-request.js';
import type { ProjectInstruction, SessionSettings } from '../core/config.js';
import { savePlan } from '../core/plan-store.js';
import { DEFAULT_COMPACT_KEEP_MESSAGES, DEFAULT_MAX_HISTORY_MESSAGES, DEFAULT_MAX_TOOL_ROUNDS } from '../core/constants.js';

export type AgentTurnResult =
  | { type: 'final'; message: string; timeline?: TimingEntry[] }
  | {
      type: 'confirmation';
      tool: string;
      args: Record<string, unknown>;
      summary: string;
      tool_call_id: string;
      timeline?: TimingEntry[];
    };

export interface TimingEntry {
  label: string;
  totalMs: number;
  calls: number;
}

export type ConfirmedToolResult =
  | { ok: true; output: string }
  | { ok: false; error: string };

export type PlanItemStatus = 'pending' | 'in_progress' | 'completed';

export interface PlanItem {
  step: string;
  status: PlanItemStatus;
}

// ── Timeline helper ──────────────────────────────────────────

class Timeline {
  private entries = new Map<string, { totalMs: number; calls: number }>();

  record(label: string, durationMs: number): void {
    const existing = this.entries.get(label) ?? { totalMs: 0, calls: 0 };
    existing.totalMs += durationMs;
    existing.calls += 1;
    this.entries.set(label, existing);
  }

  snapshot(): TimingEntry[] {
    return [...this.entries.entries()]
      .map(([label, data]) => ({ label, totalMs: data.totalMs, calls: data.calls }))
      .sort((a, b) => b.totalMs - a.totalMs);
  }

  reset(): void {
    this.entries.clear();
  }
}

// ── TerminalAgent ────────────────────────────────────────────

export class TerminalAgent {
  private readonly history: ChatMessage[] = [];
  private readonly plan: PlanItem[] = [];
  private readonly timeline = new Timeline();
  private readonly registry: ToolRegistry;
  private readonly maxToolRounds: number;
  private readonly maxHistoryMessages: number;

  constructor(private readonly options: {
    cwd: string;
    provider: ChatProvider;
    projectInstructions?: ProjectInstruction[];
    onToken?: (token: string) => void;
    onReasoning?: (text: string) => void;
    /** Inject a custom tool registry (defaults to the built-in one). */
    registry?: ToolRegistry;
    /** Session limits from .helix/config.json */
    session?: SessionSettings;
    /** Restored plan items from .helix/plan.json */
    initialPlan?: PlanItem[];
  }) {
    this.registry = options.registry ?? createDefaultRegistry();
    this.maxToolRounds = options.session?.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    this.maxHistoryMessages = options.session?.maxHistoryMessages ?? DEFAULT_MAX_HISTORY_MESSAGES;
    if (options.initialPlan?.length) {
      this.plan.push(...options.initialPlan.map((item) => ({ ...item })));
    }
    this.registry.setUpdatePlan((args) => JSON.stringify(this.updatePlan(args)));
  }

  async run(input: string, options?: { signal?: AbortSignal }): Promise<AgentTurnResult> {
    this.timeline.reset();
    return this.completeTurn([{ role: 'user', content: input }], options?.signal);
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

  /** Get a copy of all history messages (for persistence) */
  getHistory(): ChatMessage[] {
    return [...this.history];
  }

  compactHistory(keepMessages = DEFAULT_COMPACT_KEEP_MESSAGES): number {
    const keep = Math.max(0, Math.floor(keepMessages));
    if (this.history.length > keep) {
      this.history.splice(0, this.history.length - keep);
      // Remove orphaned tool messages at the start (their parent tool_calls was stripped)
      while (this.history.length > 0 && this.history[0]?.role === 'tool') {
        this.history.shift();
      }
    }
    return this.history.length;
  }

  /** Load persisted history messages into agent history */
  loadHistory(messages: ChatMessage[]): void {
    // Keep all messages except system (we generate system prompt fresh each turn)
    const filtered = messages.filter((m) => m.role !== 'system');
    if (filtered.length > 0) {
      this.history.push(...filtered);
    }
  }

  currentPlan(): PlanItem[] {
    return this.plan.map((item) => ({ ...item }));
  }

  /** Tool registry used by this agent (share with confirmation UI). */
  getToolRegistry(): ToolRegistry {
    return this.registry;
  }

  // ── Private run loop ──────────────────────────────────────

  private async completeTurn(turnMessages: ChatMessage[], signal?: AbortSignal): Promise<AgentTurnResult> {
    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(this.options.projectInstructions ?? []) },
      ...this.history,
      ...turnMessages
    ];

    for (let i = 0; i < this.maxToolRounds; i += 1) {
      const llmStart = performance.now();
      const result = await this.getLLMResponse(messages, signal);

      this.timeline.record('llm', performance.now() - llmStart);

      // Non-streaming path: emit reasoning at once (streaming path emits via SSE onReasoning)
      if (!this.options.onToken && result.reasoning_content && this.options.onReasoning) {
        this.options.onReasoning(result.reasoning_content);
      }

      // Native tool calls from the provider
      if (result.type === 'tool_calls') {
        const batchResult = await this.handleToolCallsBatch(
          result.calls,
          result.content ?? null,
          result.reasoning_content ?? null,
          turnMessages,
          messages,
          signal
        );
        if (batchResult) return batchResult;
        continue;
      }

      // Text response — check for legacy JSON protocol fallback
      const request = parseToolRequest(result.content);
      if (!request) {
        turnMessages.push({ role: 'assistant', content: result.content, reasoning_content: result.reasoning_content ?? null });
        this.appendHistory(turnMessages);
        return { type: 'final', message: result.content, timeline: this.timeline.snapshot() };
      }

      // Legacy JSON protocol fallback (for models that don't support native tool calling)
      turnMessages.push({ role: 'assistant', content: result.content, reasoning_content: result.reasoning_content ?? null });

      if (this.registry.isConfirmed(request.tool)) {
        if (this.registry.hasShellRisk(request.tool)) {
          const command = String(request.args?.command ?? '').trim();
          const risk = classifyShellCommand(command);
          if (risk.risk === 'blocked') {
            turnMessages.push({
              role: 'tool',
              content: JSON.stringify({ ok: false, error: risk.reason ?? 'Command blocked.' })
            });
            this.appendHistory(turnMessages);
            return { type: 'final', message: risk.reason ?? 'Command blocked.', timeline: this.timeline.snapshot() };
          }
        }
        this.appendHistory(turnMessages);
        return {
          type: 'confirmation',
          tool: request.tool,
          args: request.args ?? {},
          summary: toolSummary(request.tool, request.args ?? {}),
          tool_call_id: '',
          timeline: this.timeline.snapshot()
        };
      }

      if (signal?.aborted) {
        this.appendHistory(turnMessages);
        return { type: 'final', message: 'Interrupted.', timeline: this.timeline.snapshot() };
      }
      const observation = await this.executeTool({ id: '', name: request.tool, arguments: request.args ?? {} }, signal);
      turnMessages.push({ role: 'tool', content: observation, tool_call_id: '' });
      messages.splice(
        0,
        messages.length,
        { role: 'system', content: buildSystemPrompt(this.options.projectInstructions ?? []) },
        ...this.history,
        ...turnMessages
      );
    }

    this.appendHistory(turnMessages);
    return { type: 'final', message: 'HelixCode stopped after too many tool rounds.', timeline: this.timeline.snapshot() };
  }

  /** Process a batch of native tool_calls: parallel safe tools, then confirm/block. */
  private async handleToolCallsBatch(
    calls: ToolCall[],
    assistantContent: string | null,
    reasoningContent: string | null,
    turnMessages: ChatMessage[],
    messages: ChatMessage[],
    signal?: AbortSignal
  ): Promise<AgentTurnResult | null> {
    let stopIndex = calls.length;
    let stopReason: 'confirm' | 'block' | null = null;
    let blockMessage: string | undefined;

    for (let idx = 0; idx < calls.length; idx += 1) {
      const call = calls[idx]!;
      turnMessages.push({
        role: 'assistant',
        content: assistantContent,
        tool_calls: [call],
        reasoning_content: reasoningContent
      });

      if (this.registry.hasShellRisk(call.name)) {
        const command = String(call.arguments.command ?? '').trim();
        const risk = classifyShellCommand(command);
        if (risk.risk === 'blocked') {
          stopIndex = idx;
          stopReason = 'block';
          blockMessage = risk.reason ?? 'Command blocked.';
          break;
        }
        stopIndex = idx;
        stopReason = 'confirm';
        break;
      }

      if (this.registry.isConfirmed(call.name)) {
        stopIndex = idx;
        stopReason = 'confirm';
        break;
      }
    }

    const safeCalls = calls.slice(0, stopReason === null ? calls.length : stopIndex);

    if (signal?.aborted && safeCalls.length > 0) {
      this.appendHistory(turnMessages);
      return { type: 'final', message: 'Interrupted.', timeline: this.timeline.snapshot() };
    }

    if (safeCalls.length > 0) {
      const observations = await Promise.all(
        safeCalls.map((call) => this.executeTool(call, signal))
      );
      for (let idx = 0; idx < safeCalls.length; idx += 1) {
        turnMessages.push({
          role: 'tool',
          content: observations[idx] ?? JSON.stringify({ ok: false, error: 'No observation.' }),
          tool_call_id: safeCalls[idx]!.id
        });
      }
    }

    if (stopReason === 'block') {
      const blocked = calls[stopIndex]!;
      turnMessages.push({
        role: 'tool',
        content: JSON.stringify({ ok: false, error: blockMessage ?? 'Command blocked.' }),
        tool_call_id: blocked.id
      });
      this.appendHistory(turnMessages);
      return { type: 'final', message: blockMessage ?? 'Command blocked.', timeline: this.timeline.snapshot() };
    }

    if (stopReason === 'confirm') {
      const pending = calls[stopIndex]!;
      this.appendHistory(turnMessages);
      return {
        type: 'confirmation',
        tool: pending.name,
        args: pending.arguments,
        summary: toolSummary(pending.name, pending.arguments),
        tool_call_id: pending.id,
        timeline: this.timeline.snapshot()
      };
    }

    messages.splice(
      0,
      messages.length,
      { role: 'system', content: buildSystemPrompt(this.options.projectInstructions ?? []) },
      ...this.history,
      ...turnMessages
    );
    return null;
  }

  private async getLLMResponse(
    messages: ChatMessage[],
    signal?: AbortSignal
  ): Promise<
    { type: 'text'; content: string; reasoning_content?: string | null }
    | { type: 'tool_calls'; calls: ToolCall[]; content?: string | null; reasoning_content?: string | null }
  > {
    const definitions = this.registry.getDefinitions();
    if (this.options.onToken && this.options.provider.completeStream) {
      return this.options.provider.completeStream(messages, this.options.onToken, {
        tools: definitions,
        ...(signal ? { signal } : {}),
        ...(this.options.onReasoning ? { onReasoning: this.options.onReasoning } : {})
      });
    }
    return this.options.provider.complete(messages, definitions);
  }

  /** Dispatch a safe tool call through the registry. */
  private async executeTool(call: ToolCall, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) return JSON.stringify({ ok: false, error: 'Interrupted.' });

    const start = performance.now();
    try {
      const args = call.arguments ?? {};
      return await this.registry.executeSafe(call.name, this.options.cwd, args, signal);
    } finally {
      this.timeline.record(call.name, performance.now() - start);
    }
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
    savePlan(this.options.cwd, this.currentPlan()).catch(() => {});
    return { ok: true, plan: this.currentPlan() };
  }

  private appendHistory(messages: ChatMessage[]): void {
    this.history.push(...messages);
    if (this.history.length > this.maxHistoryMessages) {
      this.history.splice(0, this.history.length - this.maxHistoryMessages);
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
    'You are HelixCode, a versatile AI assistant running in the terminal.',
    'You are NOT Claude, NOT ChatGPT, and NOT an Anthropic product. You are HelixCode.',
    'Never mention Claude, Anthropic, OpenAI, or any other AI company name.',
    'When asked who you are, say "I am HelixCode, an AI assistant running in the terminal."',
    'Be concise, practical, and focused on completing the user request.',
    'Do NOT use Markdown formatting (**, ##, |table|, ---, `code`) in your responses.',
    'Output plain text suitable for terminal display. Use simple indentation for structure.',
    '',
    'For GENERAL tasks (writing essays, analysis, Q&A, research, creative writing):',
    '  Feel free to reply with text directly. No tool calls needed for pure text tasks.',
    '  Write naturally and comprehensively. Long-form content is fine.',
    '  For long essays or documents, you can use write_file to save the output to a file.',
    '  Use web_search to research topics you are unsure about.',
    '',
    'For CODING tasks (projects, codebases, files):',
    '  Start by exploring with read_file, search_files, or list_files.',
    '  Before editing, inspect the relevant files first.',
    '  Make small, targeted edits that match the existing code style.',
    '  Use update_plan for multi-step work.',
    '  After changing code, run the smallest relevant verification command.',
    '  If a tool returns an error, read the error and recover.',
    '',
    'Available tools:',
    '  read_file, search_files, list_files - explore files',
    '  write_file, replace_in_file, edit_file, apply_patch - edit files (requires confirmation)',
    '  git_status, git_diff - check git state',
    '  web_search, web_fetch - research online',
    '  run_shell - run commands (requires confirmation)',
    '  update_plan - track multi-step work',
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
