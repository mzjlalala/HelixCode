export type SlashCommandResult =
  | { handled: true; output: string; exit: boolean; clear: boolean }
  | { handled: false };

export function handleSlashCommand(input: string): SlashCommandResult {
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

  if (command === '/exit' || command === '/quit' || command === '/q') {
    return { handled: true, exit: true, clear: false, output: 'Goodbye.' };
  }

  return { handled: true, exit: false, clear: false, output: `Unknown command: ${input}` };
}
