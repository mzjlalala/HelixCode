/**
 * 终端 Agent 核心循环
 *
 * 管理对话历史、工具调用与计划状态，驱动 LLM 多轮交互：
 * - completeTurn：单轮完整流程（LLM → 工具 → 确认/终局）
 * - handleToolCallsBatch：原生 tool_calls 批处理，安全工具并行执行
 * - 遗留 JSON 工具协议由 tool-request 模块解析作为兜底
 */
import { classifyShellCommand } from '../tools/shell.js';
import { createDefaultRegistry, ToolRegistry } from '../tools/registry.js';
import { clearWebSearchSessionCache } from '../tools/web.js';
import type { ChatMessage, ChatProvider, ChatResult, ToolCall } from '../llm/types.js';
import { parseToolRequest } from './tool-request.js';
import type { ProjectInstruction, SessionSettings, HelixFileConfig, LlmProvider } from '../core/config.js';
import { resolveContextTokenLimit } from '../core/model-context-limits.js';
import { savePlan } from '../core/plan-store.js';
import {
  DEFAULT_COMPACT_KEEP_MESSAGES,
  DEFAULT_MAX_HISTORY_MESSAGES,
  DEFAULT_MAX_TOOL_ROUNDS
} from '../core/constants.js';
import { compactMessagesByTokenBudget } from '../core/history-compact.js';
import { buildContextUsage, estimateMessagesTokens, type ContextUsage } from '../core/token-estimate.js';
import type { TokenUsage } from '../llm/types.js';
import type { ToolActivityEvent, ToolCallStreamEvent } from './stream-events.js';

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

// ── 耗时统计辅助类 ──────────────────────────────────────────

/** 按标签累计各阶段/工具调用耗时，供 turn 结束时输出 timeline。 */
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

// ── TerminalAgent 主类 ───────────────────────────────────────

export class TerminalAgent {
  private readonly history: ChatMessage[] = [];
  private readonly plan: PlanItem[] = [];
  private readonly timeline = new Timeline();
  private readonly registry: ToolRegistry;
  private readonly maxToolRounds: number;
  private readonly maxHistoryMessages: number;
  /** 当前模型对应的 context 上限（随 /model 切换更新） */
  private contextTokenLimit: number;
  private activeModel: string;
  private readonly contextLimitFile: Pick<HelixFileConfig, 'contextTokenLimit' | 'modelContextLimits'>;
  private readonly llmProvider: LlmProvider;
  /** 最近一次 LLM 响应的 API usage（DeepSeek/OpenAI） */
  private lastTokenUsage: TokenUsage | null = null;
  /** 上次 API 请求时的 history.length + turnMessages.length（与 prompt_tokens 对应） */
  private lastUsageMessageCount = -1;
  /** 待确认工具：本轮未完成的 assistant+tool 前缀（不可写入 history 直到确认） */
  private pendingTurnMessages: ChatMessage[] | null = null;

  constructor(private readonly options: {
    cwd: string;
    provider: ChatProvider;
    projectInstructions?: ProjectInstruction[];
    onToken?: (token: string) => void;
    onReasoning?: (text: string) => void;
    /** 每轮 LLM 请求开始前（重置 tool 流式 UI 状态） */
    onLlmRoundStart?: () => void;
    /** tool_calls 参数 JSON 增量 */
    onToolCallDelta?: (event: ToolCallStreamEvent) => void;
    /** 安全工具执行开始/结束 */
    onToolActivity?: (event: ToolActivityEvent) => void;
    /** Inject a custom tool registry (defaults to the built-in one). */
    registry?: ToolRegistry;
    /** Session limits from .helix/config.json */
    session?: SessionSettings;
    /** Restored plan items from .helix/plan.json */
    initialPlan?: PlanItem[];
    /** 当前 chat 模型（用于按模型解析 context 上限） */
    initialModel?: string;
    /** LLM provider，context 默认值回退用 */
    llmProvider?: LlmProvider;
    /** .helix/config.json 中的 context 相关字段 */
    contextLimits?: Pick<HelixFileConfig, 'contextTokenLimit' | 'modelContextLimits'>;
  }) {
    this.registry = options.registry ?? createDefaultRegistry();
    this.maxToolRounds = options.session?.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    this.maxHistoryMessages = options.session?.maxHistoryMessages ?? DEFAULT_MAX_HISTORY_MESSAGES;
    this.contextLimitFile = options.contextLimits ?? {};
    this.llmProvider = options.llmProvider ?? 'openai';
    this.activeModel = options.initialModel ?? '';
    this.contextTokenLimit = resolveContextTokenLimit(
      this.activeModel,
      this.contextLimitFile,
      this.llmProvider
    );
    if (options.initialPlan?.length) {
      this.plan.push(...options.initialPlan.map((item) => ({ ...item })));
    }
    this.registry.setUpdatePlan((args) => JSON.stringify(this.updatePlan(args)));
  }

  /** 处理用户输入，开启新一轮 Agent 循环。 */
  async run(input: string, options?: { signal?: AbortSignal }): Promise<AgentTurnResult> {
    this.timeline.reset();
    clearWebSearchSessionCache();
    return this.completeTurn([{ role: 'user', content: input }], options?.signal);
  }

  /** 用户确认危险/写操作工具后，将执行结果作为 tool 消息继续本轮。 */
  async continueAfterConfirmation(
    confirmation: Extract<AgentTurnResult, { type: 'confirmation' }>,
    result: ConfirmedToolResult
  ): Promise<AgentTurnResult> {
    const toolMsg: ChatMessage = {
      role: 'tool',
      content: JSON.stringify({
        confirmedTool: confirmation.tool,
        args: confirmation.args,
        result
      }),
      tool_call_id: confirmation.tool_call_id
    };
    if (this.pendingTurnMessages) {
      const turnMessages = [...this.pendingTurnMessages, toolMsg];
      this.pendingTurnMessages = null;
      return this.completeTurn(turnMessages);
    }
    return this.completeTurn([toolMsg]);
  }

  /** 用户跳过确认时，将拒绝结果写入历史，避免 LLM 重复请求同一操作。 */
  recordSkippedConfirmation(
    confirmation: Extract<AgentTurnResult, { type: 'confirmation' }>
  ): void {
    const toolMsg: ChatMessage = {
      role: 'tool',
      content: JSON.stringify({
        confirmedTool: confirmation.tool,
        args: confirmation.args,
        result: { ok: false, error: 'User skipped this action.' }
      }),
      tool_call_id: confirmation.tool_call_id
    };
    if (this.pendingTurnMessages) {
      this.appendHistory([...this.pendingTurnMessages, toolMsg]);
      this.pendingTurnMessages = null;
      return;
    }
    this.appendHistory([toolMsg]);
  }

  /** 供 /model 切换后更新 context 上限 */
  setActiveModel(model: string): void {
    this.activeModel = model;
    this.contextTokenLimit = resolveContextTokenLimit(
      model,
      this.contextLimitFile,
      this.llmProvider
    );
  }

  /** 当前生效的 context token 上限 */
  getContextTokenLimit(): number {
    return this.contextTokenLimit;
  }

  clearHistory(): void {
    this.history.splice(0, this.history.length);
    this.lastTokenUsage = null;
    this.lastUsageMessageCount = -1;
    this.pendingTurnMessages = null;
  }

  historySize(): number {
    return this.history.length;
  }

  /** 获取历史消息副本（用于持久化）。 */
  getHistory(): ChatMessage[] {
    return [...this.history];
  }

  /**
   * 压缩内存历史，保留最近 keepMessages 条。
   * 裁剪后若开头残留孤立的 tool 消息（对应 assistant 的 tool_calls 已被裁掉），则一并移除。
   */
  compactHistory(keepMessages = DEFAULT_COMPACT_KEEP_MESSAGES): number {
    const keep = Math.max(0, Math.floor(keepMessages));
    if (this.history.length > keep) {
      this.history.splice(0, this.history.length - keep);
      while (this.history.length > 0 && this.history[0]?.role === 'tool') {
        this.history.shift();
      }
    }
    return this.history.length;
  }

  /**
   * 按 token 预算压缩历史（从尾部保留，直到估算 token ≤ targetTokens）。
   * 用于 context 接近上限时的 /compact。
   */
  compactHistoryByTokens(targetTokens: number): number {
    const { messages } = compactMessagesByTokenBudget(this.history, targetTokens);
    this.history.splice(0, this.history.length, ...messages);
    return this.history.length;
  }

  /** 估算当前内存历史的 token 数 */
  estimateHistoryTokens(): number {
    return estimateMessagesTokens(this.history);
  }

  /** 从持久化存储恢复历史；system 消息由每轮动态生成，不加载。 */
  loadHistory(messages: ChatMessage[]): void {
    const filtered = messages.filter((m) => m.role !== 'system');
    if (filtered.length > 0) {
      this.history.push(...filtered);
    }
  }

  currentPlan(): PlanItem[] {
    return this.plan.map((item) => ({ ...item }));
  }

  /** 供确认 UI 共享的工具注册表（与 Agent 使用同一实例）。 */
  getToolRegistry(): ToolRegistry {
    return this.registry;
  }

  /**
   * 当前会话上下文用量：优先最近一次 API 的 prompt_tokens（DeepSeek usage），
   * history 变更后回退为本地估算。
   */
  getContextUsage(): ContextUsage {
    const systemPrompt = buildSystemPrompt(this.options.projectInstructions ?? []);
    const apiStale = this.lastTokenUsage !== null
      && this.history.length !== this.lastUsageMessageCount;
    return buildContextUsage(
      systemPrompt,
      this.history,
      this.contextTokenLimit,
      this.lastTokenUsage,
      apiStale
    );
  }

  // ── 私有运行循环 ──────────────────────────────────────────

  /**
   * 完成一轮 Agent 交互的核心循环。
   *
   * 流程：组装 messages → LLM 响应 → 原生 tool_calls / 文本 / 遗留 JSON 协议分支 →
   * 工具执行或返回 confirmation / final，最多 maxToolRounds 轮。
   */
  private async completeTurn(turnMessages: ChatMessage[], signal?: AbortSignal): Promise<AgentTurnResult> {
    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(this.options.projectInstructions ?? []) },
      ...this.history,
      ...turnMessages
    ];

    for (let i = 0; i < this.maxToolRounds; i += 1) {
      const llmStart = performance.now();
      const result = await this.getLLMResponse(messages, signal);
      this.recordTokenUsage(result.usage, this.history.length + turnMessages.length);

      this.timeline.record('llm', performance.now() - llmStart);

      // 非流式路径：一次性输出 reasoning（流式路径通过 SSE onReasoning 逐块推送）
      if (!this.options.onToken && result.reasoning_content && this.options.onReasoning) {
        this.options.onReasoning(result.reasoning_content);
      }

      // Provider 返回的原生 tool_calls
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

      // 纯文本响应 — 尝试解析遗留 JSON 工具协议
      const request = parseToolRequest(result.content);
      if (!request) {
        turnMessages.push({ role: 'assistant', content: result.content, reasoning_content: result.reasoning_content ?? null });
        this.appendHistory(turnMessages);
        return { type: 'final', message: result.content, timeline: this.timeline.snapshot() };
      }

      // 遗留 JSON 协议兜底（不支持原生 function calling 的模型）
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
      // 刷新 messages 以包含最新 tool 观测，进入下一轮 LLM
      messages.splice(
        0,
        messages.length,
        { role: 'system', content: buildSystemPrompt(this.options.projectInstructions ?? []) },
        ...this.history,
        ...turnMessages
      );
    }

    const message = await this.synthesizeFinalAnswer(turnMessages, signal);
    this.appendHistory(turnMessages);
    return {
      type: 'final',
      message,
      timeline: this.timeline.snapshot(),
    };
  }

  /**
   * 工具轮次用尽时，无 tools 再调一次 LLM，根据已收集的 tool 结果汇总回答。
   */
  private async synthesizeFinalAnswer(
    turnMessages: ChatMessage[],
    signal?: AbortSignal
  ): Promise<string> {
    const nudge: ChatMessage = {
      role: 'user',
      content:
        '[System] Maximum tool rounds reached for this turn. Using all information gathered above, give the most complete answer possible to the user\'s request. Clearly state anything that could not be verified. Do NOT call any more tools.',
    };
    turnMessages.push(nudge);

    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(this.options.projectInstructions ?? []) },
      ...this.history,
      ...turnMessages,
    ];

    try {
      const llmStart = performance.now();
      const result = await this.getLLMResponseWithoutTools(messages, signal);
      this.timeline.record('llm', performance.now() - llmStart);

      const body =
        result.type === 'text'
          ? result.content
          : 'Unable to finish research within the tool round limit. Try a narrower question or increase maxToolRounds in .helix/config.json.';

      turnMessages.push({ role: 'assistant', content: body });
      return `${body}\n\n(Note: tool round limit reached; answer synthesized from collected search/fetch results. Increase maxToolRounds in .helix/config.json if you need deeper research.)`;
    } catch {
      return 'HelixCode stopped after too many tool rounds. Partial results are in the conversation above. Increase maxToolRounds in .helix/config.json or ask a narrower question.';
    }
  }

  /** 无 tools 的 LLM 调用（用于轮次用尽后的汇总） */
  private async getLLMResponseWithoutTools(
    messages: ChatMessage[],
    signal?: AbortSignal
  ): Promise<ChatResult> {
    this.options.onLlmRoundStart?.();
    if (this.options.onToken && this.options.provider.completeStream) {
      return this.options.provider.completeStream(messages, this.options.onToken, {
        ...(signal ? { signal } : {}),
        ...(this.options.onReasoning ? { onReasoning: this.options.onReasoning } : {}),
      });
    }
    return this.options.provider.complete(messages);
  }

  /**
   * 处理一批原生 tool_calls。
   *
   * OpenAI/DeepSeek 要求：一条 assistant（含 tool_calls 数组）后紧跟每条 call 的 tool 消息。
   * 策略：从左到右扫描，遇到需确认或 shell 风险工具前，先将前缀中的「安全工具」并行执行。
   */
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

    // 扫描：确定首个需暂停的位置（确认 / 拦截）
    for (let idx = 0; idx < calls.length; idx += 1) {
      const call = calls[idx]!;

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

    // 单条 assistant 携带本批 tool_calls（API 格式要求，不可拆成多条 assistant）
    const batchCalls = calls.slice(0, stopReason === null ? calls.length : stopIndex + 1);
    turnMessages.push({
      role: 'assistant',
      content: assistantContent,
      tool_calls: batchCalls,
      reasoning_content: reasoningContent ?? '',
    });

    const safeCalls = calls.slice(0, stopReason === null ? calls.length : stopIndex);

    if (signal?.aborted && safeCalls.length > 0) {
      this.appendHistory(turnMessages);
      return { type: 'final', message: 'Interrupted.', timeline: this.timeline.snapshot() };
    }

    // 安全工具并行执行
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
      // 待确认：assistant 已写入 turnMessages，但 pending 的 tool 尚未响应，不可持久化到 history
      this.pendingTurnMessages = [...turnMessages];
      return {
        type: 'confirmation',
        tool: pending.name,
        args: pending.arguments,
        summary: toolSummary(pending.name, pending.arguments),
        tool_call_id: pending.id,
        timeline: this.timeline.snapshot()
      };
    }

    // 全部安全工具已执行，刷新 messages 继续下一轮 LLM
    messages.splice(
      0,
      messages.length,
      { role: 'system', content: buildSystemPrompt(this.options.projectInstructions ?? []) },
      ...this.history,
      ...turnMessages
    );
    return null;
  }

  /** 保存 API 返回的 usage（对齐 DeepSeek response.usage） */
  private recordTokenUsage(usage: TokenUsage | undefined, messageCountAtRequest: number): void {
    if (!usage) return;
    this.lastTokenUsage = usage;
    this.lastUsageMessageCount = messageCountAtRequest;
  }

  /** 调用 LLM；有 onToken 时走流式 completeStream，否则非流式 complete。 */
  private async getLLMResponse(
    messages: ChatMessage[],
    signal?: AbortSignal
  ): Promise<ChatResult> {
    const definitions = this.registry.getDefinitions();
    this.options.onLlmRoundStart?.();
    if (this.options.onToken && this.options.provider.completeStream) {
      return this.options.provider.completeStream(messages, this.options.onToken, {
        tools: definitions,
        ...(signal ? { signal } : {}),
        ...(this.options.onReasoning ? { onReasoning: this.options.onReasoning } : {}),
        ...(this.options.onToolCallDelta ? { onToolCallDelta: this.options.onToolCallDelta } : {})
      });
    }
    return this.options.provider.complete(messages, definitions);
  }

  /** 通过 registry 分发安全工具调用，并记录耗时。 */
  private async executeTool(call: ToolCall, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) return JSON.stringify({ ok: false, error: 'Interrupted.' });

    const summary = toolSummary(call.name, call.arguments ?? {});
    this.options.onToolActivity?.({ phase: 'start', tool: call.name, summary });
    const start = performance.now();
    try {
      const args = call.arguments ?? {};
      return await this.registry.executeSafe(call.name, this.options.cwd, args, signal);
    } finally {
      const ms = performance.now() - start;
      this.timeline.record(call.name, ms);
      this.options.onToolActivity?.({ phase: 'end', tool: call.name, ms });
    }
  }

  /** update_plan 工具回调：校验 items 并持久化到 .helix/plan.json。 */
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

  /** 追加历史并在超出 maxHistoryMessages 时从头部裁剪。 */
  private appendHistory(messages: ChatMessage[]): void {
    this.history.push(...messages);
    if (this.history.length > this.maxHistoryMessages) {
      this.history.splice(0, this.history.length - this.maxHistoryMessages);
      while (this.history.length > 0 && this.history[0]?.role === 'tool') {
        this.history.shift();
      }
    }
  }
}

/** 为确认 UI 生成工具操作摘要文案。 */
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

/** 构建 Agent 系统提示，包含行为准则、工具说明与项目指令。 */
export function buildSystemPrompt(projectInstructions: ProjectInstruction[]): string {
  const lines = [
    'You are HelixCode, a versatile AI assistant running in the terminal.',
    'When asked who you are, say "I am HelixCode, an AI assistant running in the terminal."',
    'Be concise, practical, and focused on completing the user request.',
    'Do NOT use Markdown formatting (**, ##, |table|, ---, `code`) in your responses.',
    'Output plain text suitable for terminal display. Use simple indentation for structure.',
    '',
    'For GENERAL tasks (writing essays, analysis, Q&A, research, creative writing):',
    '  Feel free to reply with text directly. No tool calls needed for pure text tasks.',
    '  Write naturally and comprehensively. Long-form content is fine.',
    '  For long essays or documents, you can use write_file to save the output to a file.',
    '  Use web_search for topics you are unsure about. Use the user language in queries (Chinese for 中文 topics).',
    '  Research efficiently: at most 3 different web_search queries, then answer from snippets; use web_fetch on the best URL.',
    '  If web_fetch returns empty, pick another URL from search results — do not repeat the same search.',
    '  Always deliver a useful answer from what you have; never stop without replying to the user.',
    '  Read search snippets before searching again. Do NOT repeat the same query; if duplicateQuery or noResults, rephrase once then answer.',
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
