#!/usr/bin/env node
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
import { loadConfig, loadFileConfig, loadPermissionMode, loadProjectInstructions, savePermissionMode } from '../core/config.js';
import { loadHistory, saveHistory } from '../core/history-store.js';
import { TerminalAgent } from '../agent/terminal-agent.js';
import { OpenAIChatProvider } from '../llm/openai-provider.js';
import { completeSlashCommand, formatDoctor, handleSlashCommand, SLASH_COMMANDS } from './slash-commands.js';
import { executeConfirmedTool, previewConfirmedTool } from '../agent/confirmed-action.js';
import type { ConfirmedToolResult, TimingEntry } from '../agent/terminal-agent.js';
import { showWelcome, style, SYMBOL } from './style.js';
import { cycleMode, formatModeTag, MODE_LABELS, PermissionMode, shouldAutoApprove, shouldSkip } from './permission-mode.js';
import { undoLast } from '../tools/undo.js';

// Windows console output helper.
// On Windows TTY: use process.stdout.write() → WriteConsoleW (direct UTF-16, no codepage issues).
// Other platforms / non-TTY: use writeSync(1, ...) for reliable raw-bytes flushing.
const writeOutput = process.platform === 'win32' && process.stdout.isTTY
  ? (text: string) => { process.stdout.write(text); }
  : (text: string) => writeSync(1, text);

// On Windows, force UTF-8 console code page for Unicode display.
// Some terminals (Windows Terminal, ConEmu) may not inherit the code page
// from the parent process, so we set it at startup.
if (process.platform === 'win32') {
  try {
    execSync('chcp.com 65001 > nul', { windowsHide: true, timeout: 3000 });
    // Also set stream encoding to ensure Node.js pipes use UTF-8
    process.stdout.setDefaultEncoding('utf-8');
    process.stderr.setDefaultEncoding('utf-8');
  } catch { /* best-effort — terminal may already be UTF-8 */ }
}

const INV_BG = '\x1b[48;5;236m\x1b[38;5;255m';
const FG_RESTORE = '\x1b[38;5;255m';
const RESET = '\x1b[0m';

// Top-level error boundary
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
  .argument('[prompt...]', 'Task to run once without starting the REPL')
  .action(async (promptParts: string[], options: {
    cwd: string; doctor?: boolean; yes?: boolean; maxTurns?: string; model?: string; mode?: string
  }) => {
    if (options.doctor) {
      output.write(`${await createDoctorOutput(options.cwd)}\n`);
      return;
    }
    const prompt = joinPromptArgs(promptParts);
    if (prompt) {
      await runOnce(options.cwd, prompt, {
        autoConfirm: options.yes === true,
        maxTurns: parseMaxTurns(options.maxTurns),
        ...(options.model ? { model: options.model } : {})
      });
      return;
    }
    await runRepl(options.cwd, options.model, options.mode as PermissionMode | undefined);
  });

let currentAbort: AbortController | null = null;
let currentMode: PermissionMode = 'default';
let streamedThisTurn = false;
let lastOutput: 'reasoning' | 'content' | null = null;
let turnStartMs = 0;
let cliTimings: TimingEntry[] = [];
let timerInterval: ReturnType<typeof setInterval> | null = null;
let timerFrame = 0;
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

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

function stopTimer(): void {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function stopTimerAndFreeze(): void {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
    // Clear the animated spinner line so streaming content follows cleanly
    output.write('\r' + ' '.repeat(30) + '\r');
  }
}

// Strip Markdown formatting for non-streamed output
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


export async function runOnce(
  cwd: string,
  prompt: string,
  options: { autoConfirm?: boolean; maxTurns?: number; model?: string } = {}
): Promise<void> {
  const context = await createRuntimeContext(cwd, options.model);
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
  stopTimer(); // safety cleanup
  output.write(`${style.info(await createOneShotGitSummary(context.config.cwd))}\n`);
}

export async function runRepl(cwd: string, modelOverride?: string, modeOverride?: PermissionMode): Promise<void> {
  const context = await createRuntimeContext(cwd, modelOverride);
  if (!context) return;
  const { config, projectInstructions, runtime, agent } = context;

  // Load initial permission mode: CLI --mode > .helix/config.json > default
  currentMode = modeOverride ?? (await loadPermissionMode(config.cwd)) ?? 'default';

  // Load persisted history
  const savedMessages = await loadHistory(config.cwd);
  if (savedMessages.length > 0) {
    agent.loadHistory(savedMessages);
    output.write(`Restored session: ${savedMessages.length} messages from .helix/history.json\n`);
  }

  showWelcome(config.cwd, modelOverride ? runtime.model : '', SLASH_COMMANDS.map((c) => c.name).join(' '));
  if (projectInstructions.length) {
    output.write(`Loaded project instructions: ${projectInstructions.map((item) => item.path).join(', ')}\n`);
  }

  if (!input.isTTY) {
    const content = await readAllStdin();
    for (const line of content.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      const exit = await handleInputLine(line, { agent, config, projectInstructions, runtime, rl: null });
      if (exit) return;
    }
    return;
  }

  const completer = (line: string): CompleterResult => {
    if (!line.trimStart().startsWith('/')) return [[], line];
    const candidates = completeSlashCommand(line);
    return [candidates.length ? candidates : SLASH_COMMANDS.map((c) => c.name), line];
  };

  // Prep listener BEFORE createInterface so our handler fires before readline's
  let modeCyclePending = false;
  let rl: ReturnType<typeof createInterface>;
  emitKeypressEvents(input);
  input.prependListener('keypress', (_str: string, key: { name?: string; shift?: boolean }) => {
    if (key && key.name === 'tab' && key.shift && !closing) {
      currentMode = cycleMode(currentMode);
      modeCyclePending = true;
      savePermissionMode(config.cwd, currentMode).catch(() => {});
    }
  });

  rl = createInterface({ input, output, completer });
  let closing = false;

  rl.on('SIGINT', () => {
    if (currentAbort) {
      currentAbort.abort();
      currentAbort = null;
      output.write('\n');
      return;
    }
    closing = true;
    output.write(`\n${style.dim('Goodbye.')}\n`);
    saveHistory(config.cwd, agent.getHistory()).catch(() => {});
    rl.close();
  });

  while (!closing) {
    let line: string;
    try {
      if (modeCyclePending) {
        modeCyclePending = false;
        output.write(`${RESET}\n${style.dim(`◈ ${MODE_LABELS[currentMode].label}: ${MODE_LABELS[currentMode].desc}`)}\n`);
      }
      output.write(`\n${INV_BG}${formatModeTag(currentMode, FG_RESTORE)} `);
      line = (await rl.question('> ')).trim();
    } catch {
      if (!closing) output.write(`\n${style.dim('Goodbye.')}\n`);
      break;
    } finally {
      output.write(RESET);
    }
    if (!line) continue;
    if (await handleInputLine(line, { agent, config, projectInstructions, runtime, rl })) break;
  }

  rl.close();
}

async function handleInputLine(
  line: string,
  context: {
    agent: TerminalAgent;
    config: ReturnType<typeof loadConfig>;
    projectInstructions: Awaited<ReturnType<typeof loadProjectInstructions>>;
    runtime: { model: string };
    rl: ReturnType<typeof createInterface> | null;
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
    compactedHistoryMessages: 20
  });
  if (slash.handled) {
    if (slash.model) {
      context.runtime.model = slash.model;
    }
    if (slash.cycleMode) {
      currentMode = cycleMode(currentMode);
      slash.output = style.dim(`◈ ${MODE_LABELS[currentMode].label}: ${MODE_LABELS[currentMode].desc}`);
      // Persist mode to config file
      savePermissionMode(context.config.cwd, currentMode).catch(() => {});
    }
    if (slash.compact) {
      context.agent.compactHistory(slash.compactKeep ?? 20);
    }
    output.write(`${slash.output}\n`);
    if (slash.historySave) {
      saveHistory(context.config.cwd, context.agent.getHistory()).catch(() => {});
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
  // Auto-save history after each turn
  saveHistory(context.config.cwd, context.agent.getHistory()).catch(() => {});
  return false;
}

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
    // Write response message first
    const message = !streamedThisTurn ? stripMarkdown(result.message) : '';
    if (!streamedThisTurn) {
      const prefix = lastOutput ? '\n' : '';
      output.write(`${prefix}${message}\n`);
    } else {
      output.write('\n');
    }

    // Then timing
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

  if (streamedThisTurn || lastOutput) output.write('\n');
  streamedThisTurn = false;
  lastOutput = null;

  output.write(`${style.label('┈')} ${style.bold(result.tool.replace(/_/g, ' '))}  ${style.dim(result.summary)}\n`);
  const preview = await previewConfirmedTool(context.config.cwd, result);
  output.write(`${preview}\n`);

  // Permission mode: plan → auto-skip
  if (shouldSkip(result.tool, currentMode)) {
    context.agent.recordSkippedConfirmation(result);
    output.write(`${style.dim(`${SYMBOL.info} ${MODE_LABELS[currentMode].label}: skipped ${result.tool}`)}\n`);
    return;
  }

  // Permission mode: auto-approve (auto / acceptEdits)
  if (shouldAutoApprove(result.tool, currentMode)) {
    output.write(`${style.dim(`${MODE_LABELS[currentMode].label}: auto-approved`)}\n`);
    const toolStart = performance.now();
    const commandResult = await executeConfirmedTool(context.config.cwd, result);
    cliTimings.push({ label: result.tool, totalMs: performance.now() - toolStart, calls: 1 });
    output.write(`${formatConfirmedToolResult(commandResult)}\n`);
    const followUp = await context.agent.continueAfterConfirmation(result, commandResult);
    await handleAgentResult(followUp, context);
    return;
  }

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
    const commandResult = await executeConfirmedTool(context.config.cwd, result);
    cliTimings.push({ label: result.tool, totalMs: performance.now() - toolStart, calls: 1 });
    output.write(`${formatConfirmedToolResult(commandResult)}\n`);
    const followUp = await context.agent.continueAfterConfirmation(result, commandResult);
    await handleAgentResult(followUp, { ...context, remainingTurns: remainingTurns - 1 });
    return;
  }

  const rl = context.rl;
  if (!rl) return;
  const answer = (await rl.question(`${style.dim('Proceed? [y/N]')} `)).trim().toLowerCase();
  if (answer === 'y' || answer === 'yes') {
    const toolStart = performance.now();
    const commandResult = await executeConfirmedTool(context.config.cwd, result);
    cliTimings.push({ label: result.tool, totalMs: performance.now() - toolStart, calls: 1 });
    output.write(`${formatConfirmedToolResult(commandResult)}\n`);
    const followUp = await context.agent.continueAfterConfirmation(result, commandResult);
    await handleAgentResult(followUp, context);
  } else {
    context.agent.recordSkippedConfirmation(result);
    output.write(`${style.dim('Skipped.')}\n`);
    // Show partial timeline on skip
    const partialTimeline = result.timeline ?? [];
    const partialTotal = performance.now() - turnStartMs;
    if (partialTimeline.length > 0) {
      output.write(`${formatTimeline(partialTimeline, partialTotal)}\n`);
    }
    cliTimings = [];
  }
}

function formatConfirmedToolResult(result: ConfirmedToolResult): string {
  if (!result.ok) return `${style.error(`${SYMBOL.error} ${result.error}`)}`;
  return `${style.success(`${SYMBOL.success} ${result.output}`)}`;
}

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

function formatTimeline(entries: TimingEntry[], totalMs: number): string {
  const total = (totalMs / 1000).toFixed(1);

  // Only LLM calls, no tool calls → just show total
  const hasTools = entries.some((e) => e.label !== 'llm');
  if (!hasTools) {
    return style.dim(`⠿ ${total}s`);
  }

  // Show detailed timeline
  const parts = entries.map((e) => {
    const time = (e.totalMs / 1000).toFixed(1);
    return e.calls > 1 ? `${e.label} ${time}s (${e.calls})` : `${e.label} ${time}s`;
  });

  return style.dim(`⠿ ${total}s · ${parts.join(' · ')}`);
}

async function createRuntimeContext(cwd: string, modelOverride?: string): Promise<{
  config: ReturnType<typeof loadConfig>;
  projectInstructions: Awaited<ReturnType<typeof loadProjectInstructions>>;
  runtime: { model: string };
  agent: TerminalAgent;
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

  const projectInstructions = await loadProjectInstructions(config.cwd);
  const runtime = { model: config.model };
  const provider = new OpenAIChatProvider(config, runtime);
  const agent = new TerminalAgent({
    cwd: config.cwd,
    provider,
    projectInstructions,
    onToken: (token) => {
      stopTimerAndFreeze();
      streamedThisTurn = true;
      if (lastOutput === 'reasoning') writeOutput('\n');
      lastOutput = 'content';
      // Write in small synchronous bursts so Windows console renders progressively
      for (let i = 0; i < token.length; i += 4) {
        writeOutput(token.slice(i, i + 4));
      }
    },
    onReasoning: (text) => {
      stopTimerAndFreeze();
      if (lastOutput === 'content') writeOutput('\n');
      lastOutput = 'reasoning';
      writeOutput(`\x1b[2m\x1b[3m${text}\x1b[0m`);
    }
  });
  return { config, projectInstructions, runtime, agent };
}

export function joinPromptArgs(parts: string[]): string {
  return parts.join(' ').trim();
}

export function parseMaxTurns(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 10;
}
async function createOneShotGitSummary(cwd: string): Promise<string> {
  const [status, diffStat] = await Promise.all([
    runGit(cwd, ['status', '--short']),
    runGit(cwd, ['diff', '--stat'])
  ]);
  return formatOneShotGitSummary(status, diffStat);
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync('git', args, { cwd, windowsHide: true });
    return result.stdout;
  } catch {
    return '';
  }
}

export function formatOneShotGitSummary(status: string, diffStat: string): string {
  const cleanStatus = status.trimEnd();
  const cleanDiffStat = diffStat.trimEnd();
  if (!cleanStatus && !cleanDiffStat) return 'Git changes: none';
  return ['Git changes:', cleanStatus, cleanDiffStat].filter(Boolean).join('\n');
}

export function formatMissingApiKeyMessage(): string {
  return [
    'HELIX_API_KEY is not set. Set HELIX_API_KEY to enable HelixCode agent reasoning.',
    'PowerShell example:',
    '$env:HELIX_API_KEY="your-api-key"',
    'OPENAI_API_KEY is also accepted as a fallback.'
  ].join('\n');
}

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

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

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
  await program.parseAsync(process.argv);
}
