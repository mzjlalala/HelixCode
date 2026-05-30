#!/usr/bin/env node
import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../core/config.js';
import { TerminalAgent } from '../agent/terminal-agent.js';
import { OpenAIChatProvider } from '../llm/openai-provider.js';
import { handleSlashCommand } from './slash-commands.js';
import { runShellCommand } from '../tools/shell.js';

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
  const provider = new OpenAIChatProvider(config);
  const agent = new TerminalAgent({ cwd: config.cwd, provider });
  const rl = createInterface({ input, output });

  output.write(`HelixCode ready in ${config.cwd}\n`);
  output.write('Type /help for commands, /exit to quit.\n\n');

  while (true) {
    const line = (await rl.question('helix> ')).trim();
    if (!line) continue;

    const slash = handleSlashCommand(line);
    if (slash.handled) {
      output.write(`${slash.output}\n`);
      if (slash.clear) console.clear();
      if (slash.exit) break;
      continue;
    }

    const result = await agent.run(line);
    if (result.type === 'final') {
      output.write(`${result.message}\n`);
      continue;
    }

    const answer = (await rl.question(`Run "${result.command}"? [y/N] `)).trim().toLowerCase();
    if (answer === 'y' || answer === 'yes') {
      const commandResult = await runShellCommand(config.cwd, result.command);
      output.write(`${JSON.stringify(commandResult, null, 2)}\n`);
    } else {
      output.write('Command skipped.\n');
    }
  }

  rl.close();
}

export function isMainModule(metaUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath) return false;
  return resolve(fileURLToPath(metaUrl)) === resolve(argvPath);
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await program.parseAsync(process.argv);
}
