#!/usr/bin/env node
import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadProjectInstructions } from '../core/config.js';
import { TerminalAgent } from '../agent/terminal-agent.js';
import { OpenAIChatProvider } from '../llm/openai-provider.js';
import { handleSlashCommand } from './slash-commands.js';
import { executeConfirmedTool, previewConfirmedTool } from '../agent/confirmed-action.js';
import type { ConfirmedToolResult } from '../agent/terminal-agent.js';

const program = new Command();

program
  .name('helix')
  .description('HelixCode terminal coding agent')
  .version('0.1.0')
  .option('-C, --cwd <path>', 'Project directory', process.cwd())
  .action(async (options: { cwd: string }) => {
    await runRepl(options.cwd);
  });

export async function runRepl(cwd: string): Promise<void> {
  const config = loadConfig({ cwd });
  if (!config.apiKey.trim()) {
    output.write(`${formatMissingApiKeyMessage()}\n`);
    process.exitCode = 1;
    return;
  }

  const projectInstructions = await loadProjectInstructions(config.cwd);
  const runtime = { model: config.model };
  const provider = new OpenAIChatProvider(config, runtime);
  const agent = new TerminalAgent({ cwd: config.cwd, provider, projectInstructions });

  output.write(`HelixCode ready in ${config.cwd}\n`);
  if (projectInstructions.length) {
    output.write(`Loaded project instructions: ${projectInstructions.map((item) => item.path).join(', ')}\n`);
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

  const result = await context.agent.run(line);
  await handleAgentResult(result, context);
  return false;
}

async function handleAgentResult(
  result: Awaited<ReturnType<TerminalAgent['run']>>,
  context: {
    agent: TerminalAgent;
    config: ReturnType<typeof loadConfig>;
    rl: ReturnType<typeof createInterface> | null;
  }
): Promise<void> {
  if (result.type === 'final') {
    output.write(`${result.message}\n`);
    return;
  }

  const preview = await previewConfirmedTool(context.config.cwd, result);
  output.write(`${preview}\n`);

  if (!context.rl) {
    output.write(`${result.summary}? [y/N] Command skipped in non-interactive mode.\n`);
    context.agent.recordSkippedConfirmation(result);
    return;
  }

  const answer = (await context.rl.question(`${result.summary}? [y/N] `)).trim().toLowerCase();
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

export function formatMissingApiKeyMessage(): string {
  return [
    'HELIX_API_KEY is not set. Set HELIX_API_KEY to enable HelixCode agent reasoning.',
    'PowerShell example:',
    '$env:HELIX_API_KEY="your-api-key"',
    'OPENAI_API_KEY is also accepted as a fallback.'
  ].join('\n');
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
