export type SlashCommandResult =
  | { handled: true; output: string; exit: boolean; clear: boolean }
  | { handled: false };

export interface SlashCommandContext {
  cwd?: string;
  model?: string;
  historyMessages?: number;
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
        '/help    Show this help',
        '/status  Show current project, model, and session state',
        '/tools   Show available agent tools',
        '/clear   Clear the screen and session context',
        '/exit    Exit HelixCode'
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
        `model: ${context.model ?? 'unknown'}`,
        `history messages: ${context.historyMessages ?? 0}`
      ].join('\n')
    };
  }

  if (command === '/tools') {
    return {
      handled: true,
      exit: false,
      clear: false,
      output: [
        'HelixCode tools:',
        'read_file      Read a project file',
        'list_files     List project files',
        'search_files   Search text in project files',
        'git_status     Inspect git status',
        'git_diff       Inspect git diff',
        'write_file     Write a file after confirmation',
        'apply_patch    Apply a unified diff after confirmation',
        'run_shell      Run a shell command after confirmation'
      ].join('\n')
    };
  }

  if (command === '/exit' || command === '/quit' || command === '/q') {
    return { handled: true, exit: true, clear: false, output: 'Goodbye.' };
  }

  return { handled: true, exit: false, clear: false, output: `Unknown command: ${input}` };
}
