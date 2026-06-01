#!/usr/bin/env node
/**
 * HelixCode CLI 入口模块
 *
 * 负责解析命令行参数，启动 REPL 交互循环或一次性（one-shot）任务执行。
 * 核心流程包括：运行时上下文创建、Agent 流式输出、工具确认循环、
 * 权限模式切换、斜杠命令分发与会话历史持久化。
 */
import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import type { CompleterResult } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { writeSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { execFile, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadFileConfig, loadPermissionMode, loadProjectInstructions, resolveSessionSettings, savePermissionMode, type SessionSettings } from '../core/config.js';
import { loadHistory, saveHistory } from '../core/history-store.js';
import { loadPlan } from '../core/plan-store.js';
import { TerminalAgent } from '../agent/terminal-agent.js';
import { OpenAIChatProvider } from '../llm/openai-provider.js';
import { completeSlashCommand, formatDoctor, handleSlashCommand, SLASH_COMMANDS } from './slash-commands.js';
import { executeConfirmedTool, previewConfirmedTool } from '../agent/confirmed-action.js';
import type { ConfirmedToolResult, TimingEntry } from '../agent/terminal-agent.js';
import { showWelcome, style, SYMBOL } from './style.js';
import { cycleMode, formatModeTag, MODE_LABELS, PermissionMode, shouldAutoApprove, shouldSkip } from './permission-mode.js';
import { undoLast, loadUndoStack } from '../tools/undo.js';

/**
 * 跨平台控制台输出辅助
 * Windows TTY：process.stdout.write → WriteConsoleW（UTF-16，避免代码页问题）
 * 其他平台或非 TTY：writeSync(1, ...) 保证原始字节可靠刷新
 */
const writeOutput = process.platform === 'win32' && process.stdout.isTTY
  ? (text: string) => { process.stdout.write(text); }
  : (text: string) => writeSync(1, text);

// Windows 启动时强制 UTF-8 代码页，确保 Unicode 正常显示
// 部分终端（Windows Terminal、ConEmu）可能未继承父进程代码页
if (process.platform === 'win32') {
  try {
    execSync('chcp.com 65001 > nul', { windowsHide: true, timeout: 3000 });
    // 同步设置流编码，保证 Node 管道使用 UTF-8
    process.stdout.setDefaultEncoding('utf-8');
    process.stderr.setDefaultEncoding('utf-8');
  } catch { /* 尽力而为 — 终端可能已是 UTF-8 */ }
}

/** REPL 提示符反色背景与前景恢复用的 ANSI 序列 */
const INV_BG = '\x1b[48;5;236m\x1b[38;5;255m';
const FG_RESTORE = '\x1b[38;5;255m';
const RESET = '\x1b[0m';

// 顶层未捕获错误边界，避免静默崩溃
process.on('unhandledRejection', (reason) => {
  output.write(`\n${style.error(`${SYMBOL.error} Unhandled error: ${reason instanceof Error ? reason.message : String(reason)}`)}\n`);
});
process.on('uncaughtException', (error) => {
  output.write(`\n${style.error(`${SYMBOL.error} Fatal error: ${error.message}`)}\n`);
});

const execFileAsync = promisify(execFile);

const program = new Command();

program
  .name('helix')
  .description('HelixCode terminal coding agent')
  .version('0.2.0')
  .option('-C, --cwd <path>', 'Project directory', process.cwd())
  .option('--doctor', 'Show local HelixCode diagnostics and exit')
  .option('-y, --yes', 'Automatically execute confirmed actions in one-shot mode')
  .option('--max-turns <number>', 'Maximum one-shot confirmation turns', '10')
  .option('--model <name>', 'Chat model to use (overrides HELIX_CHAT_MODEL)')
  .option('--mode <name>', 'Permission mode: default|edit|plan|auto')
  .option('--max-tool-rounds <number>', 'Max tool rounds per agent turn (overrides config)')
  .argument('[prompt...]', 'Task to run once without starting the REPL')
  .action(async (promptParts: string[], options: {
    cwd: string; doctor?: boolean; yes?: boolean; maxTurns?: string; model?: string; mode?: string;
    maxToolRounds?: string;
  }) => {
    // --doctor：输出诊断信息后退出
    if (options.doctor) {
      output.write(`${await createDoctorOutput(options.cwd)}\n`);
      process.exit(process.exitCode || 0);
    }
    const prompt = joinPromptArgs(promptParts);
    // 有 prompt 参数：一次性模式；否则进入 REPL
    if (prompt) {
      await runOnce(options.cwd, prompt, {
        autoConfirm: options.yes === true,
        maxTurns: parseMaxTurns(options.maxTurns),
        ...(options.model ? { model: options.model } : {}),
        ...(options.maxToolRounds ? { maxToolRounds: parseMaxToolRounds(options.maxToolRounds) } : {})
      });
      process.exit(process.exitCode || 0);
    }
    await runRepl(options.cwd, options.model, options.mode as PermissionMode | undefined, {
      ...(options.maxToolRounds ? { maxToolRounds: parseMaxToolRounds(options.maxToolRounds) } : {})
    });
  });

/** REPL 会话级状态（跨多轮输入共享） */
let currentAbort: AbortController | null = null;
let currentMode: PermissionMode = 'default';
let streamedThisTurn = false;
let lastOutput: 'reasoning' | 'content' | null = null;
let turnStartMs = 0;
let cliTimings: TimingEntry[] = [];
let timerInterval: ReturnType<typeof setInterval> | null = null;
let timerFrame = 0;
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** 启动 Agent 等待期间的旋转计时器（200ms 刷新） */
function startTimer(): void {
  timerFrame = 0;
  const update = () => {
    const elapsed = (performance.now() - turnStartMs) / 1000;
    output.write(`\r${style.dim(`${SPINNER[timerFrame]} ${elapsed.toFixed(1)}s`)}`);
    timerFrame = (timerFrame + 1) % SPINNER.length;
  };
  update();
  timerInterval = setInterval(update, 200);
}

/** 停止计时器（不清理当前行） */
function stopTimer(): void {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

/** 停止计时器并擦除 spinner 行，便于流式内容紧接输出 */
function stopTimerAndFreeze(): void {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
    // 清空动画行，避免与后续流式文本重叠
    output.write('\r' + ' '.repeat(30) + '\r');
  }
}

/**
 * 移除非流式输出中的 Markdown 格式，适配纯终端显示
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/^-\s+/gm, '• ')
    .replace(/^\|[\s:-]+\|[\s:-]+\|$/gm, '')
    .replace(/^\|(.+)\|$/gm, (_, s) => s.split('|').map((c: string) => c.trim()).join('  '))
    .replace(/^---+$/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '');
}


/**
 * 一次性执行模式：运行单条 prompt，处理确认循环后输出 Git 摘要
 * @param cwd 工作目录
 * @param prompt 用户任务描述
 * @param options autoConfirm、maxTurns、model、maxToolRounds 等
 */
export async function runOnce(
  cwd: string,
  prompt: string,
  options: { autoConfirm?: boolean; maxTurns?: number; model?: string; maxToolRounds?: number } = {}
): Promise<void> {
  const context = await createRuntimeContext(cwd, options.model, {
    ...(options.maxToolRounds ? { maxToolRounds: options.maxToolRounds } : {})
  });
  if (!context) return;
  turnStartMs = performance.now();
  cliTimings = [];
  startTimer();
  const result = await context.agent.run(prompt);
  stopTimerAndFreeze();
  await handleAgentResult(result, {
    agent: context.agent,
    config: context.config,
    rl: null,
    autoConfirm: options.autoConfirm === true,
    remainingTurns: options.maxTurns ?? 10
  });
  stopTimer(); // 兜底清理
  output.write(`${style.info(await createOneShotGitSummary(context.config.cwd))}\n`);
}

/**
 * 交互式 REPL 主循环
 * 支持：历史恢复、斜杠命令、Shift+Tab 切换权限模式、Ctrl+C 中断/退出
 */
export async function runRepl(
  cwd: string,
  modelOverride?: string,
  modeOverride?: PermissionMode,
  runtimeOpts: { maxToolRounds?: number } = {}
): Promise<void> {
  const context = await createRuntimeContext(cwd, modelOverride, runtimeOpts);
  if (!context) return;
  const { config, projectInstructions, runtime, agent, session } = context;

  // 权限模式优先级：CLI --mode > .helix/config.json > default
  currentMode = modeOverride ?? (await loadPermissionMode(config.cwd)) ?? 'default';

  // 从磁盘恢复会话历史
  const savedMessages = await loadHistory(config.cwd);
  if (savedMessages.length > 0) {
    agent.loadHistory(savedMessages);
    output.write(`Restored session: ${savedMessages.length} messages from .helix/history.json\n`);
  }

  showWelcome(config.cwd, modelOverride ? runtime.model : '', SLASH_COMMANDS.map((c) => c.name).join(' '));
  if (projectInstructions.length) {
    output.write(`Loaded project instructions: ${projectInstructions.map((item) => item.path).join(', ')}\n`);
  }

  // 非 TTY（管道输入）：逐行读取 stdin，不启动 readline 交互
  if (!input.isTTY) {
    const content = await readAllStdin();
    for (const line of content.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      const exit = await handleInputLine(line, { agent, config, projectInstructions, runtime, rl: null, session });
      if (exit) {
        saveAgentHistory(config.cwd, agent, session);
        process.exit(0);
      }
    }
    return;
  }

  /** Tab 补全：斜杠命令前缀匹配 */
  const completer = (line: string): CompleterResult => {
    if (!line.trimStart().startsWith('/')) return [[], line];
    const candidates = completeSlashCommand(line);
    return [candidates.length ? candidates : SLASH_COMMANDS.map((c) => c.name), line];
  };

  // 须在 createInterface 之前注册 keypress，确保先于 readline 收到 Shift+Tab
  let rl: ReturnType<typeof createInterface>;
  emitKeypressEvents(input);
  input.prependListener('keypress', (_str: string, key: { name?: string; shift?: boolean }) => {
    if (key && key.name === 'tab' && key.shift && !closing) {
      currentMode = cycleMode(currentMode);
      savePermissionMode(config.cwd, currentMode).catch(() => {});

      // 更新 readline 提示符并刷新当前行
      // readline 会把 ANSI 转义序列计入长度，需手动修正光标位置
      if (rl) {
        rl.setPrompt(`${INV_BG}${formatModeTag(currentMode, FG_RESTORE)} > `);
        rl.prompt(true);
        // 可见提示符长度 = 模式标签 + " > "
        const visualPromptLen = MODE_LABELS[currentMode].label.length + 3;
        const cursorInLine = (rl as any).cursor ?? 0;
        writeOutput(`\x1b[${visualPromptLen + cursorInLine + 1}G`);
      }
    }
  });

  rl = createInterface({ input, output, completer });
  let closing = false;

  // 第一次 Ctrl+C 中断当前 Agent；无进行中任务时退出 REPL
  rl.on('SIGINT', () => {
    if (currentAbort) {
      currentAbort.abort();
      currentAbort = null;
      output.write('\n');
      return;
    }
    closing = true;
    output.write(`\n${style.dim('Goodbye.')}\n`);
    saveAgentHistory(config.cwd, agent, session);
    rl.close();
    process.exit(0);
  });

  // 主输入循环
  while (!closing) {
    let line: string;
    try {
      output.write(`\n${INV_BG}${formatModeTag(currentMode, FG_RESTORE)} `);
      line = (await rl.question('> ')).trim();
    } catch {
      if (!closing) output.write(`\n${style.dim('Goodbye.')}\n`);
      break;
    } finally {
      output.write(RESET);
    }
    if (!line) continue;
    if (await handleInputLine(line, { agent, config, projectInstructions, runtime, rl, session })) {
      saveAgentHistory(config.cwd, agent, session);
      process.exit(0);
    }
  }

  rl.close();
}

/**
 * 处理单行用户输入：斜杠命令分支或 Agent 运行分支
 * @returns true 表示应退出 REPL（如 /exit）
 */
async function handleInputLine(
  line: string,
  context: {
    agent: TerminalAgent;
    config: ReturnType<typeof loadConfig>;
    projectInstructions: Awaited<ReturnType<typeof loadProjectInstructions>>;
    runtime: { model: string };
    rl: ReturnType<typeof createInterface> | null;
    session: SessionSettings;
  }
): Promise<boolean> {
  const slash = handleSlashCommand(line, {
    cwd: context.config.cwd,
    model: context.runtime.model,
    baseURL: context.config.baseURL,
    provider: context.config.provider,
    apiKeyConfigured: Boolean(context.config.apiKey.trim()),
    historyMessages: context.agent.historySize(),
    historyMessageList: context.agent.getHistory(),
    projectInstructions: context.projectInstructions.map((item) => item.path),
    planItems: context.agent.currentPlan(),
    compactedHistoryMessages: context.session.compactKeepMessages,
    maxHistoryMessages: context.session.maxHistoryMessages,
    maxToolRounds: context.session.maxToolRounds
  });
  if (slash.handled) {
    if (slash.model) {
      context.runtime.model = slash.model;
    }
    if (slash.cycleMode) {
      currentMode = cycleMode(currentMode);
      slash.output = style.dim(`◈ ${MODE_LABELS[currentMode].label}: ${MODE_LABELS[currentMode].desc}`);
      // 持久化模式到 .helix/config.json
      savePermissionMode(context.config.cwd, currentMode).catch(() => {});
    }
    if (slash.compact) {
      context.agent.compactHistory(slash.compactKeep ?? context.session.compactKeepMessages);
    }
    output.write(`${slash.output}\n`);
    if (slash.historySave) {
      saveAgentHistory(context.config.cwd, context.agent, context.session);
    }
    if (slash.undo) {
      undoLast(context.config.cwd).then((result) => {
        if (result.ok) {
          output.write(`${style.success(`${SYMBOL.success} Undid ${result.entry.tool}: restored ${result.entry.path}`)}\n`);
        } else {
          output.write(`${style.dim(`Cannot undo: ${result.error}`)}\n`);
        }
      }).catch(() => {});
    }
    if (slash.clear || slash.reset) {
      context.agent.clearHistory();
    }
    if (slash.clear) {
      console.clear();
    }
    return slash.exit;
  }

  // 普通用户消息：启动 Agent，支持 Ctrl+C 中断
  const abort = new AbortController();
  currentAbort = abort;
  streamedThisTurn = false;
  lastOutput = null;
  turnStartMs = performance.now();
  cliTimings = [];
  startTimer();
  try {
    const result = await context.agent.run(line, { signal: abort.signal });
    stopTimerAndFreeze();
    // 中断后若已有 partial 结果，仍输出时间线
    if (result.type === 'final' && abort.signal.aborted) {
      const partialTotal = performance.now() - turnStartMs;
      const timeline = result.timeline ?? [];
      if (timeline.length > 0) {
        output.write(`${formatTimeline(timeline, partialTotal)}\n`);
      }
      return false;
    }
    await handleAgentResult(result, context);
  } finally {
    stopTimer();
    if (currentAbort === abort) currentAbort = null;
  }
  // 每轮对话结束后自动保存历史
  saveAgentHistory(context.config.cwd, context.agent, context.session);
  return false;
}

/**
 * 处理 Agent 单次 run 的返回结果
 * - type === 'final'：输出最终文本与时间线
 * - 否则进入工具确认循环（权限模式 / 交互确认 / one-shot --yes）
 */
async function handleAgentResult(
  result: Awaited<ReturnType<TerminalAgent['run']>>,
  context: {
    agent: TerminalAgent;
    config: ReturnType<typeof loadConfig>;
    rl: ReturnType<typeof createInterface> | null;
    autoConfirm?: boolean;
    remainingTurns?: number;
  }
): Promise<void> {
  if (result.type === 'final') {
    // 先输出回复正文
    const message = !streamedThisTurn ? stripMarkdown(result.message) : '';
    if (!streamedThisTurn) {
      const prefix = lastOutput ? '\n' : '';
      output.write(`${prefix}${message}\n`);
    } else {
      output.write('\n');
    }

    // 再输出耗时时间线
    const merged = mergeAgentTimeline(result.timeline, cliTimings);
    const totalWallClock = performance.now() - turnStartMs;
    if (merged.length > 0 || cliTimings.length > 0) {
      output.write(`${formatTimeline(merged, totalWallClock)}\n`);
    }
    cliTimings = [];
    streamedThisTurn = false;
    lastOutput = null;
    return;
  }

  // 需确认的工具调用：先换行，再展示工具名与预览
  if (streamedThisTurn || lastOutput) output.write('\n');
  streamedThisTurn = false;
  lastOutput = null;

  output.write(`${style.label('┈')} ${style.bold(result.tool.replace(/_/g, ' '))}  ${style.dim(result.summary)}\n`);
  const preview = await previewConfirmedTool(context.config.cwd, result, context.agent.getToolRegistry());
  output.write(`${preview}\n`);

  // plan 模式：只读，自动跳过所有需确认工具
  if (shouldSkip(result.tool, currentMode)) {
    context.agent.recordSkippedConfirmation(result);
    output.write(`${style.dim(`${SYMBOL.info} ${MODE_LABELS[currentMode].label}: skipped ${result.tool}`)}\n`);
    return;
  }

  // auto / acceptEdits 模式：按策略自动批准并递归继续 Agent
  if (shouldAutoApprove(result.tool, currentMode)) {
    output.write(`${style.dim(`${MODE_LABELS[currentMode].label}: auto-approved`)}\n`);
    const toolStart = performance.now();
    const commandResult = await executeConfirmedTool(context.config.cwd, result, context.agent.getToolRegistry());
    cliTimings.push({ label: result.tool, totalMs: performance.now() - toolStart, calls: 1 });
    output.write(`${formatConfirmedToolResult(commandResult)}\n`);
    const followUp = await context.agent.continueAfterConfirmation(result, commandResult);
    await handleAgentResult(followUp, context);
    return;
  }

  // 非交互 one-shot 且未传 --yes：跳过确认
  if (!context.rl && context.autoConfirm !== true) {
    output.write(`${style.dim(`${result.summary}? [y/N]`)} ${style.dim('Command skipped in non-interactive mode.')}\n`);
    context.agent.recordSkippedConfirmation(result);
    const partialTotal = performance.now() - turnStartMs;
    const timeline = result.timeline ?? [];
    if (timeline.length > 0) {
      output.write(`${formatTimeline(timeline, partialTotal)}\n`);
    }
    cliTimings = [];
    return;
  }

  // 非交互 one-shot + --yes：自动确认，受 maxTurns 限制
  if (!context.rl && context.autoConfirm === true) {
    const remainingTurns = context.remainingTurns ?? 10;
    if (remainingTurns <= 0) {
      output.write(`${style.yellow(`${SYMBOL.warning} Stopped after reaching --max-turns.`)}\n`);
      const partialTotal = performance.now() - turnStartMs;
      const timeline = result.timeline ?? [];
      if (timeline.length > 0) {
        output.write(`${formatTimeline(timeline, partialTotal)}\n`);
      }
      cliTimings = [];
      return;
    }
    output.write(`${style.dim(`${result.summary}? [y/N]`)} ${style.green('Auto-approved by --yes.')}\n`);
    const toolStart = performance.now();
    const commandResult = await executeConfirmedTool(context.config.cwd, result, context.agent.getToolRegistry());
    cliTimings.push({ label: result.tool, totalMs: performance.now() - toolStart, calls: 1 });
    output.write(`${formatConfirmedToolResult(commandResult)}\n`);
    const followUp = await context.agent.continueAfterConfirmation(result, commandResult);
    await handleAgentResult(followUp, { ...context, remainingTurns: remainingTurns - 1 });
    return;
  }

  // 交互 REPL：询问 Proceed? [y/N]
  const rl = context.rl;
  if (!rl) return;
  const answer = (await rl.question(`${style.dim('Proceed? [y/N]')} `)).trim().toLowerCase();
  if (answer === 'y' || answer === 'yes') {
    const toolStart = performance.now();
    const commandResult = await executeConfirmedTool(context.config.cwd, result, context.agent.getToolRegistry());
    cliTimings.push({ label: result.tool, totalMs: performance.now() - toolStart, calls: 1 });
    output.write(`${formatConfirmedToolResult(commandResult)}\n`);
    const followUp = await context.agent.continueAfterConfirmation(result, commandResult);
    await handleAgentResult(followUp, context);
  } else {
    context.agent.recordSkippedConfirmation(result);
    output.write(`${style.dim('Skipped.')}\n`);
    // 用户拒绝时仍展示已消耗的部分时间线
    const partialTimeline = result.timeline ?? [];
    const partialTotal = performance.now() - turnStartMs;
    if (partialTimeline.length > 0) {
      output.write(`${formatTimeline(partialTimeline, partialTotal)}\n`);
    }
    cliTimings = [];
  }
}

/** 格式化工具确认执行结果（成功/失败着色） */
function formatConfirmedToolResult(result: ConfirmedToolResult): string {
  if (!result.ok) return `${style.error(`${SYMBOL.error} ${result.error}`)}`;
  return `${style.success(`${SYMBOL.success} ${result.output}`)}`;
}

/** 合并 Agent 内部时间线与 CLI 侧工具耗时（同 label 累加） */
function mergeAgentTimeline(agentTimeline: TimingEntry[] | undefined, cliTimings: TimingEntry[]): TimingEntry[] {
  const map = new Map<string, TimingEntry>();

  for (const entry of agentTimeline ?? []) {
    map.set(entry.label, { ...entry });
  }

  for (const entry of cliTimings) {
    const existing = map.get(entry.label);
    if (existing) {
      existing.totalMs += entry.totalMs;
      existing.calls += entry.calls;
    } else {
      map.set(entry.label, { ...entry });
    }
  }

  return [...map.values()].sort((a, b) => b.totalMs - a.totalMs);
}

/** 格式化本轮总耗时与各阶段明细 */
function formatTimeline(entries: TimingEntry[], totalMs: number): string {
  const total = (totalMs / 1000).toFixed(1);

  // 仅 LLM、无工具调用时只显示总时长
  const hasTools = entries.some((e) => e.label !== 'llm');
  if (!hasTools) {
    return style.dim(`⠿ ${total}s`);
  }

  // 含工具时展示分项耗时
  const parts = entries.map((e) => {
    const time = (e.totalMs / 1000).toFixed(1);
    return e.calls > 1 ? `${e.label} ${time}s (${e.calls})` : `${e.label} ${time}s`;
  });

  return style.dim(`⠿ ${total}s · ${parts.join(' · ')}`);
}

/**
 * 创建 Agent 运行时上下文：配置、Provider、TerminalAgent 及流式回调
 * API Key 缺失时输出提示并返回 null
 */
async function createRuntimeContext(
  cwd: string,
  modelOverride?: string,
  runtimeOpts: { maxToolRounds?: number } = {}
): Promise<{
  config: ReturnType<typeof loadConfig>;
  projectInstructions: Awaited<ReturnType<typeof loadProjectInstructions>>;
  runtime: { model: string };
  agent: TerminalAgent;
  session: SessionSettings;
} | null> {
  const config = loadConfig({ cwd });
  if (modelOverride) {
    config.model = modelOverride;
  }
  if (!config.apiKey.trim()) {
    output.write(`${formatMissingApiKeyMessage()}\n`);
    process.exitCode = 1;
    return null;
  }

  const fileConfig = await loadFileConfig(config.cwd);
  const session = resolveSessionSettings(fileConfig);
  if (runtimeOpts.maxToolRounds) {
    session.maxToolRounds = runtimeOpts.maxToolRounds;
  }

  await loadUndoStack(config.cwd);
  const initialPlan = await loadPlan(config.cwd);

  const projectInstructions = await loadProjectInstructions(config.cwd);
  const runtime = { model: config.model };
  const provider = new OpenAIChatProvider(config, runtime);
  const agent = new TerminalAgent({
    cwd: config.cwd,
    provider,
    projectInstructions,
    session,
    initialPlan,
    // 流式 token：停止 spinner，与 reasoning 输出互斥换行
    onToken: (token) => {
      stopTimerAndFreeze();
      streamedThisTurn = true;
      if (lastOutput === 'reasoning') writeOutput('\n');
      lastOutput = 'content';
      // 分块写入，降低大 token 单次 write 延迟
      for (let i = 0; i < token.length; i += 4) {
        writeOutput(token.slice(i, i + 4));
      }
    },
    // 推理/思考过程：斜体暗淡样式
    onReasoning: (text) => {
      stopTimerAndFreeze();
      if (lastOutput === 'content') writeOutput('\n');
      lastOutput = 'reasoning';
      writeOutput(`\x1b[2m\x1b[3m${text}\x1b[0m`);
    }
  });
  return { config, projectInstructions, runtime, agent, session };
}

/** 异步保存 Agent 对话历史（失败静默忽略） */
function saveAgentHistory(cwd: string, agent: TerminalAgent, session: SessionSettings): void {
  saveHistory(cwd, agent.getHistory(), session.maxHistoryMessages).catch(() => {});
}

/** 将 CLI positional 参数拼成单条 prompt 字符串 */
export function joinPromptArgs(parts: string[]): string {
  return parts.join(' ').trim();
}

/** 解析 --max-turns，非法值默认 10 */
export function parseMaxTurns(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 10;
}

/** 解析 --max-tool-rounds，非法值默认 6 */
export function parseMaxToolRounds(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 6;
}

/** 一次性模式结束后收集 git status 与 diff --stat */
async function createOneShotGitSummary(cwd: string): Promise<string> {
  const [status, diffStat] = await Promise.all([
    runGit(cwd, ['status', '--short']),
    runGit(cwd, ['diff', '--stat'])
  ]);
  return formatOneShotGitSummary(status, diffStat);
}

/** 在指定目录执行 git 子命令，失败返回空字符串 */
async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync('git', args, { cwd, windowsHide: true });
    return result.stdout;
  } catch {
    return '';
  }
}

/** 格式化 one-shot 结束时的 Git 变更摘要 */
export function formatOneShotGitSummary(status: string, diffStat: string): string {
  const cleanStatus = status.trimEnd();
  const cleanDiffStat = diffStat.trimEnd();
  if (!cleanStatus && !cleanDiffStat) return 'Git changes: none';
  return ['Git changes:', cleanStatus, cleanDiffStat].filter(Boolean).join('\n');
}

/** API Key 未配置时的提示文案 */
export function formatMissingApiKeyMessage(): string {
  return [
    'HELIX_API_KEY is not set. Set HELIX_API_KEY to enable HelixCode agent reasoning.',
    'PowerShell example:',
    '$env:HELIX_API_KEY="your-api-key"',
    'OPENAI_API_KEY is also accepted as a fallback.'
  ].join('\n');
}

/** 生成 --doctor 完整输出（含 .helix/config.json 内容） */
export async function createDoctorOutput(cwd: string): Promise<string> {
  const config = loadConfig({ cwd });
  const projectInstructions = await loadProjectInstructions(config.cwd);
  const fileConfig = await loadFileConfig(config.cwd);
  const fileConfigLines = Object.keys(fileConfig).length
    ? [`config file: .helix/config.json (${Object.keys(fileConfig).length} keys)`, `  ${JSON.stringify(fileConfig)}`]
    : ['config file: none (.helix/config.json not found)'];
  return formatDoctor({
    cwd: config.cwd,
    model: config.model,
    baseURL: config.baseURL,
    provider: config.provider,
    apiKeyConfigured: Boolean(config.apiKey.trim()),
    historyMessages: 0,
    projectInstructions: projectInstructions.map((item) => item.path),
    planItems: []
  }) + '\n' + fileConfigLines.join('\n');
}

/** 非 TTY 模式下读取 stdin 全部内容 */
async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * 判断当前模块是否作为 CLI 入口直接运行（兼容 symlink / realpath）
 */
export async function isMainModule(metaUrl: string, argvPath: string | undefined): Promise<boolean> {
  if (!argvPath) return false;
  const modulePath = resolve(fileURLToPath(metaUrl));
  const entryPath = resolve(argvPath);
  if (modulePath === entryPath) return true;
  try {
    return await realpath(modulePath) === await realpath(entryPath);
  } catch {
    return false;
  }
}

if (await isMainModule(import.meta.url, process.argv[1])) {
  program.parseAsync(process.argv).then(() => process.exit(process.exitCode || 0));
}
