#!/usr/bin/env node
import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadProjectInstructions } from '../core/config.js';
import { TerminalAgent } from '../agent/terminal-agent.js';
import { OpenAIChatProvider } from '../llm/openai-provider.js';
import { formatDoctor, handleSlashCommand } from './slash-commands.js';
import { executeConfirmedTool, previewConfirmedTool } from '../agent/confirmed-action.js';
import type { ConfirmedToolResult } from '../agent/terminal-agent.js';

// Top-level error boundary — catch crashes that would otherwise terminate the process silently
process.on('unhandledRejection', (reason) => {
  output.write(`\nUnhandled error: ${reason instanceof Error ? reason.message : String(reason)}\n`);
});
process.on('uncaughtException', (error) => {
  output.write(`\nFatal error: ${error.message}\n`);
});

const execFileAsync = promisify(execFile);

const program = new Command();

program
  .name('helix')
  .description('HelixCode terminal coding agent')
  .version('0.1.0')
  .option('-C, --cwd <path>', 'Project directory', process.cwd())
  .option('--doctor', 'Show local HelixCode diagnostics and exit')
  .option('-y, --yes', 'Automatically execute confirmed actions in one-shot mode')
  .option('--max-turns <number>', 'Maximum one-shot confirmation turns', '10')
  .option('--model <name>', 'Chat model to use (overrides HELIX_CHAT_MODEL)')
  .argument('[prompt...]', 'Task to run once without starting the REPL')
  .action(async (promptParts: string[], options: {
    cwd: string; doctor?: boolean; yes?: boolean; maxTurns?: string; model?: string
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
    await runRepl(options.cwd, options.model);
  });

// Module-level state for Ctrl+C abort across functions
let currentAbort: AbortController | null = null;

// Simple spinner on stderr — returns stop() that clears the line
let spinnerTimer: ReturnType<typeof setInterval> | null = null;

function startSpinner(): void {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  spinnerTimer = setInterval(() => {
    process.stderr.write(`\r${frames[i]}`);
    i = (i + 1) % frames.length;
  }, 80);
}

function stopSpinner(): void {
  if (spinnerTimer !== null) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
    process.stderr.write('\r\x1b[K');
  }
}

export async function runOnce(
  cwd: string,
  prompt: string,
  options: { autoConfirm?: boolean; maxTurns?: number; model?: string } = {}
): Promise<void> {
  const context = await createRuntimeContext(cwd, options.model);
  if (!context) return;
  const result = await context.agent.run(prompt);
  await handleAgentResult(result, {
    agent: context.agent,
    config: context.config,
    rl: null,
    autoConfirm: options.autoConfirm === true,
    remainingTurns: options.maxTurns ?? 10
  });
  output.write(`${await createOneShotGitSummary(context.config.cwd)}\n`);
}

export async function runRepl(cwd: string, modelOverride?: string): Promise<void> {
  const context = await createRuntimeContext(cwd, modelOverride);
  if (!context) return;
  const { config, projectInstructions, runtime, agent } = context;

  output.write(`HelixCode ready in ${config.cwd}\n`);
  if (projectInstructions.length) {
    output.write(`Loaded project instructions: ${projectInstructions.map((item) => item.path).join(', ')}\n`);
  }
  if (modelOverride) {
    output.write(`Model: ${runtime.model}\n`);
  }
  output.write('Type /help for commands, /exit to quit.\n\n');

  if (!input.isTTY) {
    const content = await readAllStdin();
    for (const line of content.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      output.write('helix> ');
      const exit = await handleInputLine(line, { agent, config, projectInstructions, runtime, rl: null });
      if (exit) return;
    }
    return;
  }

  const rl = createInterface({ input, output });
  let closing = false;

  rl.on('SIGINT', () => {
    if (currentAbort) {
      currentAbort.abort();
      currentAbort = null;
      stopSpinner();
      output.write('\n');
      return;
    }
    closing = true;
    output.write('\nGoodbye.\n');
    rl.close();
  });

  while (!closing) {
    let line: string;
    try {
      line = (await rl.question('helix> ')).trim();
    } catch {
      if (!closing) output.write('\nGoodbye.\n');
      break;
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
    projectInstructions: context.projectInstructions.map((item) => item.path),
    planItems: context.agent.currentPlan(),
    compactedHistoryMessages: 20
  });
  if (slash.handled) {
    if (slash.model) {
      context.runtime.model = slash.model;
    }
    if (slash.compact) {
      context.agent.compactHistory(20);
    }
    output.write(`${slash.output}\n`);
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
  startSpinner();
  try {
    const result = await context.agent.run(line, { signal: abort.signal });
    if (result.type === 'final' && abort.signal.aborted) {
      return false;
    }
    await handleAgentResult(result, context);
  } finally {
    stopSpinner();
    if (currentAbort === abort) currentAbort = null;
  }
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
    output.write(`${result.message}\n`);
    return;
  }

  const preview = await previewConfirmedTool(context.config.cwd, result);
  output.write(`${preview}\n`);

  if (!context.rl && context.autoConfirm !== true) {
    output.write(`${result.summary}? [y/N] Command skipped in non-interactive mode.
`);
    context.agent.recordSkippedConfirmation(result);
    return;
  }

  if (!context.rl && context.autoConfirm === true) {
    const remainingTurns = context.remainingTurns ?? 10;
    if (remainingTurns <= 0) {
      output.write('Stopped after reaching --max-turns.\n');
      return;
    }
    output.write(`${result.summary}? [y/N] Auto-approved by --yes.\n`);
    const commandResult = await executeConfirmedTool(context.config.cwd, result);
    output.write(`${formatConfirmedToolResult(commandResult)}\n`);
    const followUp = await context.agent.continueAfterConfirmation(result, commandResult);
    await handleAgentResult(followUp, { ...context, remainingTurns: remainingTurns - 1 });
    return;
  }

  const rl = context.rl;
  if (!rl) return;
  const answer = (await rl.question(`${result.summary}? [y/N] `)).trim().toLowerCase();
  if (answer === 'y' || answer === 'yes') {
    const commandResult = await executeConfirmedTool(context.config.cwd, result);
    output.write(`${formatConfirmedToolResult(commandResult)}\n`);
    const followUp = await context.agent.continueAfterConfirmation(result, commandResult);
    await handleAgentResult(followUp, context);
  } else {
    context.agent.recordSkippedConfirmation(result);
    output.write('Command skipped.\n');
  }
}

function formatConfirmedToolResult(result: ConfirmedToolResult): string {
  if (!result.ok) return `Result: failed\n${result.error}`;
  return ['Result: ok', result.output].filter(Boolean).join('\n');
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
      stopSpinner();
      output.write(token);
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
  return formatDoctor({
    cwd: config.cwd,
    model: config.model,
    baseURL: config.baseURL,
    provider: config.provider,
    apiKeyConfigured: Boolean(config.apiKey.trim()),
    historyMessages: 0,
    projectInstructions: projectInstructions.map((item) => item.path),
    planItems: []
  });
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
