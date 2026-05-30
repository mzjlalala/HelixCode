import type { PlanItem } from '../agent/terminal-agent.js';

export type SlashCommandResult =
  | { handled: true; output: string; exit: boolean; clear: boolean; reset?: boolean }
  | { handled: false };

export interface SlashCommandContext {
  cwd?: string;
  model?: string;
  historyMessages?: number;
  projectInstructions?: string[];
  planItems?: PlanItem[];
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
        '/history Show current session history size',
        '/plan    Show current session plan',
        '/tools   Show available agent tools',
        '/reset   Clear session context',
        '/clear   Clear the screen and session context',
        '/exit    Exit HelixCode'
      ].join('\n')
    };
  }

  if (command === '/clear') {
    return { handled: true, exit: false, clear: true, output: 'Session cleared.' };
  }

  if (command === '/reset') {
    return {
      handled: true,
      exit: false,
      clear: false,
      reset: true,
      output: 'Session context reset.'
    };
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
        `history messages: ${context.historyMessages ?? 0}`,
        `project instructions: ${context.projectInstructions?.length ? context.projectInstructions.join(', ') : 'none'}`
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
        'read_file      Read a project file, optionally by line range',
        'list_files     List project files',
        'search_files   Search text with optional glob/context/limit settings',
        'git_status     Inspect git status',
        'git_diff       Inspect git diff',
        'write_file     Write a file after confirmation',
        'replace_in_file Replace exact text after confirmation',
        'apply_patch    Apply a unified diff after confirmation',
        'run_shell      Run a shell command after confirmation'
      ].join('\n')
    };
  }

  if (command === '/history') {
    return {
      handled: true,
      exit: false,
      clear: false,
      output: `Session history messages: ${context.historyMessages ?? 0}`
    };
  }

  if (command === '/plan') {
    return {
      handled: true,
      exit: false,
      clear: false,
      output: formatPlan(context.planItems ?? [])
    };
  }

  if (command === '/exit' || command === '/quit' || command === '/q') {
    return { handled: true, exit: true, clear: false, output: 'Goodbye.' };
  }

  return { handled: true, exit: false, clear: false, output: `Unknown command: ${input}` };
}

function formatPlan(items: PlanItem[]): string {
  if (!items.length) return 'No active plan.';
  const labels: Record<PlanItem['status'], string> = {
    pending: 'todo',
    in_progress: 'active',
    completed: 'done'
  };
  return ['Current plan:', ...items.map((item) => `[${labels[item.status]}] ${item.step}`)].join('\n');
}
