import type { PlanItem } from '../agent/terminal-agent.js';
import type { ChatMessage } from '../llm/types.js';

export interface SlashCommandDefinition {
  name: string;
  description: string;
  usage?: string;
}

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  { name: '/help', description: 'Show this help' },
  { name: '/status', description: 'Show current project, model, and session state' },
  { name: '/doctor', description: 'Show local HelixCode diagnostics' },
  { name: '/model', description: 'Show or switch the current chat model', usage: '/model <name>' },
  { name: '/mode', description: 'Cycle permission mode (default/edit/plan/auto)' },
  { name: '/undo', description: 'Undo the last file modification' },
  { name: '/history', description: 'Show history size, search, or save', usage: '/history [search <keyword>|save]' },
  { name: '/plan', description: 'Show current session plan' },
  { name: '/compact', description: 'Compact session history', usage: '/compact [keep]' },
  { name: '/tools', description: 'Show available agent tools' },
  { name: '/reset', description: 'Clear session context' },
  { name: '/clear', description: 'Clear the screen and session context' },
  { name: '/exit', description: 'Exit HelixCode' },
  { name: '/quit', description: 'Exit HelixCode' },
  { name: '/q', description: 'Exit HelixCode' }
];

export function completeSlashCommand(input: string): string[] {
  const prefix = input.trim().toLowerCase();
  if (!prefix.startsWith('/')) return [];
  const matches = SLASH_COMMANDS.map((item) => item.name).filter((name) => name.startsWith(prefix));
  return matches.length ? matches : SLASH_COMMANDS.map((item) => item.name);
}

export function formatSlashCommandCandidates(input: string): string {
  const names = new Set(completeSlashCommand(input));
  const rows = SLASH_COMMANDS.filter((item) => names.has(item.name));
  const width = Math.max(...rows.map((item) => (item.usage ?? item.name).length));
  return rows.map((item) => {
    const label = item.usage ?? item.name;
    return `${label.padEnd(width)}  ${item.description}`;
  }).join('\n');
}

function formatSlashHelp(): string {
  return ['HelixCode commands:', formatSlashCommandCandidates('/')].join('\n');
}

export type SlashCommandResult =
  | {
      handled: true;
      output: string;
      exit: boolean;
      clear: boolean;
      reset?: boolean;
      compact?: boolean;
      compactKeep?: number;
      model?: string;
      cycleMode?: true;
      historySave?: true;
      undo?: true;
    }
  | { handled: false };

export interface SlashCommandContext {
  cwd?: string;
  model?: string;
  baseURL?: string;
  provider?: string;
  apiKeyConfigured?: boolean;
  historyMessages?: number;
  historyMessageList?: ChatMessage[];
  projectInstructions?: string[];
  planItems?: PlanItem[];
  compactedHistoryMessages?: number;
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
      output: formatSlashHelp()
    };
  }

  if (command === '/clear') {
    return { handled: true, exit: false, clear: true, output: 'Session cleared.' };
  }

  if (command === '/model' && !input.trim().startsWith('/model ')) {
    return {
      handled: true,
      exit: false,
      clear: false,
      output: `Current model: ${context.model ?? 'unknown'}\nUsage: /model <name>`
    };
  }

  if (command === '/doctor') {
    return {
      handled: true,
      exit: false,
      clear: false,
      output: formatDoctor(context)
    };
  }

  if (command.startsWith('/model ')) {
    const model = input.trim().slice('/model '.length).trim();
    if (!model) {
      return { handled: true, exit: false, clear: false, output: 'Model name is required.' };
    }
    return {
      handled: true,
      exit: false,
      clear: false,
      model,
      output: `Model set to ${model}`
    };
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

  if (command === '/compact' || command.startsWith('/compact ')) {
    const before = context.historyMessages ?? 0;
    const requested = parseInt(command === '/compact' ? '' : command.slice('/compact '.length).trim(), 10);
    const keep = Number.isFinite(requested) && requested > 0 ? requested : (context.compactedHistoryMessages ?? 20);
    const after = Math.min(before, keep);
    return {
      handled: true,
      exit: false,
      clear: false,
      compact: true,
      compactKeep: keep,
      output: `Session history compacted from ${before} to ${after} messages.`
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
        `provider: ${context.provider ?? 'unknown'}`,
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
        'edit_file      Replace an inclusive line range after confirmation',
        'apply_patch    Apply a unified diff after confirmation',
        'run_shell      Run a shell command after confirmation'
      ].join('\n')
    };
  }

  if (command === '/history' || command.startsWith('/history ')) {
    const rest = command === '/history' ? '' : command.slice('/history '.length).trim();

    // /history save
    if (rest === 'save') {
      return {
        handled: true, exit: false, clear: false,
        historySave: true,
        output: `Session history saved.`
      };
    }

    // /history search <keyword>
    if (rest.startsWith('search ')) {
      const keyword = rest.slice('search '.length).trim();
      if (!keyword) {
        return {
          handled: true, exit: false, clear: false,
          output: 'Usage: /history search <keyword>'
        };
      }
      const messages = context.historyMessageList ?? [];
      const results = messages
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content && m.content.toLowerCase().includes(keyword.toLowerCase()))
        .map((m) => {
          const role = m.role === 'user' ? 'Q' : 'A';
          // Truncate long content for display
          const text = (m.content ?? '').length > 120
            ? (m.content ?? '').slice(0, 120) + '...'
            : (m.content ?? '');
          return `[${role}] ${text}`;
        });
      if (results.length === 0) {
        return {
          handled: true, exit: false, clear: false,
          output: `No history matches for "${keyword}".`
        };
      }
      const heading = `Found ${results.length} match(es) for "${keyword}":`;
      return {
        handled: true, exit: false, clear: false,
        output: [heading, ...results].join('\n')
      };
    }

    // /history (plain)
    return {
      handled: true, exit: false, clear: false,
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

  if (command === '/mode') {
    return {
      handled: true,
      exit: false,
      clear: false,
      cycleMode: true,
      output: ''
    };
  }

  if (command === '/undo') {
    return {
      handled: true, exit: false, clear: false,
      undo: true,
      output: ''
    };
  }

  // "/" alone shows available commands (useful when Tab completion doesn't work on some terminals)
  if (command === '/') {
    return {
      handled: true,
      exit: false,
      clear: false,
      output: ['Available commands:', formatSlashCommandCandidates('/')].join('\n')
    };
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

export function formatDoctor(context: SlashCommandContext): string {
  return [
    'HelixCode doctor:',
    `cwd: ${context.cwd ?? process.cwd()}`,
    `model: ${context.model ?? 'unknown'}`,
    `provider: ${context.provider ?? 'unknown'}`,
    `base URL: ${context.baseURL ?? 'unknown'}`,
    `api key: ${context.apiKeyConfigured ? 'set' : 'missing'}`,
    `node: ${process.version}`,
    `project instructions: ${context.projectInstructions?.length ? context.projectInstructions.join(', ') : 'none'}`,
    `history messages: ${context.historyMessages ?? 0}`,
    `plan items: ${context.planItems?.length ?? 0}`
  ].join('\n');
}
