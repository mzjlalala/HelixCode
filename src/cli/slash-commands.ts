export type SlashCommandResult =
  | { handled: true; output: string; exit: boolean; clear: boolean }
  | { handled: false };

export interface SlashCommandContext {
  cwd?: string;
  model?: string;
}

export function handleSlashCommand(
  input: string,
  context: SlashCommandContext = {}
): SlashCommandResult {
  const command = input.trim().toLowerCase();

  if (!command.startsWith('/')) return { handled: false };

  if (command === '/help') {
    return {
      handled: true,
      exit: false,
      clear: false,
      output: [
        'HelixCode commands:',
        '/help   Show this help',
        '/clear  Clear the current screen',
        '/exit   Exit HelixCode'
      ].join('\n')
    };
  }

  if (command === '/clear') {
    return { handled: true, exit: false, clear: true, output: 'Session cleared.' };
  }

  if (command === '/status') {
    return {
      handled: true,
      exit: false,
      clear: false,
      output: [
        'HelixCode status:',
        `cwd: ${context.cwd ?? process.cwd()}`,
        `model: ${context.model ?? 'unknown'}`
      ].join('\n')
    };
  }

  if (command === '/exit' || command === '/quit' || command === '/q') {
    return { handled: true, exit: true, clear: false, output: 'Goodbye.' };
  }

  return { handled: true, exit: false, clear: false, output: `Unknown command: ${input}` };
}
