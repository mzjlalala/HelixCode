/**
 * 斜杠命令模块
 *
 * 定义 REPL 中以 `/` 开头的内置命令（help、status、model、compact 等），
 * 负责命令补全、分发处理，以及 doctor / plan 等格式化输出。
 */

import type { PlanItem } from '../agent/terminal-agent.js';
import type { ChatMessage } from '../llm/types.js';
import { formatContextUsageLines, type ContextUsage } from '../core/token-estimate.js';
import { DEFAULT_MAX_TOOL_ROUNDS } from '../core/constants.js';

/** 单条斜杠命令的定义：名称、描述与可选用法 */
export interface SlashCommandDefinition {
  name: string;
  description: string;
  usage?: string;
}

/** 所有内置斜杠命令列表（补全与 /help 共用） */
export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  { name: '/help', description: 'Show this help' },
  { name: '/status', description: 'Show current project, model, and session state' },
  { name: '/doctor', description: 'Show local HelixCode diagnostics' },
  { name: '/model', description: 'Show or switch the current chat model', usage: '/model <name>' },
  { name: '/mode', description: 'Cycle permission mode (default/edit/plan/auto)' },
  { name: '/undo', description: 'Undo the last file modification' },
  { name: '/history', description: 'Show history size, search, or save', usage: '/history [search <keyword>|save]' },
  { name: '/plan', description: 'Show current session plan' },
  { name: '/compact', description: 'Compact session history (token-aware by default)', usage: '/compact [N|Nk|auto]' },
  { name: '/tools', description: 'Show available agent tools' },
  { name: '/reset', description: 'Clear session context' },
  { name: '/clear', description: 'Clear the screen and session context' },
  { name: '/exit', description: 'Exit HelixCode' },
  { name: '/quit', description: 'Exit HelixCode' },
  { name: '/q', description: 'Exit HelixCode' }
];

/**
 * 根据用户已输入前缀返回匹配的命令名列表（Tab 补全）
 * @param input 当前输入行
 */
export function completeSlashCommand(input: string): string[] {
  const prefix = input.trim().toLowerCase();
  if (!prefix.startsWith('/')) return [];
  const matches = SLASH_COMMANDS.map((item) => item.name).filter((name) => name.startsWith(prefix));
  // 无精确前缀匹配时返回全部命令，便于用户选择
  return matches.length ? matches : SLASH_COMMANDS.map((item) => item.name);
}

/**
 * 将候选命令格式化为对齐的「用法 + 描述」多行文本
 */
export function formatSlashCommandCandidates(input: string): string {
  const names = new Set(completeSlashCommand(input));
  const rows = SLASH_COMMANDS.filter((item) => names.has(item.name));
  const width = Math.max(...rows.map((item) => (item.usage ?? item.name).length));
  return rows.map((item) => {
    const label = item.usage ?? item.name;
    return `${label.padEnd(width)}  ${item.description}`;
  }).join('\n');
}

/** 生成 /help 的完整帮助文本 */
function formatSlashHelp(): string {
  return ['HelixCode commands:', formatSlashCommandCandidates('/')].join('\n');
}

/** 斜杠命令处理结果：handled 为 false 表示非斜杠命令，交由 Agent 处理 */
export type SlashCommandResult =
  | {
      handled: true;
      output: string;
      exit: boolean;
      clear: boolean;
      reset?: boolean;
      compact?: boolean;
      compactKeep?: number;
      /** 按 token 预算压缩（/compact 无参数或 Nk） */
      compactByTokens?: number;
      model?: string;
      cycleMode?: true;
      historySave?: true;
      undo?: true;
    }
  | { handled: false };

/** 执行斜杠命令时可用的会话上下文（由 main.ts 注入） */
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
  maxHistoryMessages?: number;
  maxToolRounds?: number;
  /** 当前模型 context 上限（token） */
  contextTokenLimit?: number;
  /** 当前会话上下文 token 估算（由 Agent.getContextUsage 提供） */
  contextUsage?: ContextUsage;
}

/**
 * 解析并执行斜杠命令
 * @param input 用户输入行
 * @param context 当前会话上下文
 * @returns 处理结果；handled: false 时 caller 应继续走 Agent 流程
 */
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

  // 仅 /model（无参数）：显示当前模型
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

  // /model <name>：切换模型（由 main 写入 runtime.model）
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

  // /compact [N|Nk|auto]：默认按 token 预算压缩；N 为保留条数，Nk 为 token 上限
  if (command === '/compact' || command.startsWith('/compact ')) {
    const before = context.historyMessages ?? 0;
    const arg = command === '/compact' ? '' : command.slice('/compact '.length).trim();
    const parsed = parseCompactArg(arg);

    if (parsed.mode === 'tokens') {
      const target = parsed.targetTokens > 0
        ? parsed.targetTokens
        : Math.floor((context.contextTokenLimit ?? 128_000) * 0.5);
      return {
        handled: true,
        exit: false,
        clear: false,
        compact: true,
        compactByTokens: target,
        output: `Compacting history to ~${formatTokenCount(target)} tokens (from ${before} messages)…`
      };
    }

    const after = Math.min(before, parsed.keep);
    return {
      handled: true,
      exit: false,
      clear: false,
      compact: true,
      compactKeep: parsed.keep,
      output: `Session history compacted from ${before} to ${after} messages.`
    };
  }

  if (command === '/status') {
    const lines = [
      'HelixCode status:',
      `cwd: ${context.cwd ?? process.cwd()}`,
      `model: ${context.model ?? 'unknown'}`,
      `provider: ${context.provider ?? 'unknown'}`,
      `history messages: ${context.historyMessages ?? 0}${context.maxHistoryMessages ? ` / ${context.maxHistoryMessages} max` : ''}`,
      `tool rounds per turn: ${context.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS}`,
      `project instructions: ${context.projectInstructions?.length ? context.projectInstructions.join(', ') : 'none'}`
    ];
    if (context.contextUsage) {
      lines.push(...formatContextUsageLines(context.contextUsage));
    }
    return {
      handled: true,
      exit: false,
      clear: false,
      output: lines.join('\n')
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
        'run_shell      Run a shell command after confirmation',
        'web_search     Search the web (Tavily API, Bing API, or HTML fallback)',
        'web_fetch      Fetch readable text from a URL (blocks private addresses)',
        'update_plan    Track multi-step work',
      ].join('\n')
    };
  }

  if (command === '/history' || command.startsWith('/history ')) {
    const rest = command === '/history' ? '' : command.slice('/history '.length).trim();

    // /history save — 触发持久化（由 main 调用 saveAgentHistory）
    if (rest === 'save') {
      return {
        handled: true, exit: false, clear: false,
        historySave: true,
        output: `Session history saved.`
      };
    }

    // /history search <keyword> — 在历史消息中搜索关键词
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
          // 过长内容截断，避免刷屏
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

    //  plain /history — 仅显示消息条数
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

  // /mode — 由 main 执行 cycleMode 并更新提示符
  if (command === '/mode') {
    return {
      handled: true,
      exit: false,
      clear: false,
      cycleMode: true,
      output: ''
    };
  }

  // /undo — 由 main 异步调用 undoLast
  if (command === '/undo') {
    return {
      handled: true, exit: false, clear: false,
      undo: true,
      output: ''
    };
  }

  // 单独输入 "/" 时列出可用命令（部分终端 Tab 补全不可用时仍可用）
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


/** 将计划项格式化为带状态标签的多行文本 */
function formatPlan(items: PlanItem[]): string {
  if (!items.length) return 'No active plan.';
  const labels: Record<PlanItem['status'], string> = {
    pending: 'todo',
    in_progress: 'active',
    completed: 'done'
  };
  return ['Current plan:', ...items.map((item) => `[${labels[item.status]}] ${item.step}`)].join('\n');
}

/**
 * 生成环境诊断信息（/doctor 与 CLI --doctor 共用）
 */
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
    `plan items: ${context.planItems?.length ?? 0}`,
    `web search: ${formatWebSearchBackend()}`,
    ...(context.contextUsage ? formatContextUsageLines(context.contextUsage) : [])
  ].join('\n');
}

/** 解析 /compact 参数：无参或 auto → token 模式；Nk / 大数字 → token；小整数 → 保留条数 */
export function parseCompactArg(arg: string): { mode: 'messages'; keep: number } | { mode: 'tokens'; targetTokens: number } {
  const trimmed = arg.trim().toLowerCase();
  if (!trimmed || trimmed === 'auto') {
    return { mode: 'tokens', targetTokens: 0 };
  }

  const kMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*k$/);
  if (kMatch) {
    return { mode: 'tokens', targetTokens: Math.floor(parseFloat(kMatch[1]!) * 1000) };
  }

  const num = parseInt(trimmed, 10);
  if (Number.isFinite(num) && num > 300) {
    return { mode: 'tokens', targetTokens: num };
  }
  if (Number.isFinite(num) && num > 0) {
    return { mode: 'messages', keep: num };
  }

  return { mode: 'tokens', targetTokens: 0 };
}

function formatWebSearchBackend(): string {
  if (process.env.TAVILY_API_KEY?.trim()) return 'Tavily (TAVILY_API_KEY set)';
  if (process.env.HELIX_BING_API_KEY?.trim()) return 'Bing API (HELIX_BING_API_KEY set)';
  return 'HTML fallback (set TAVILY_API_KEY for reliable results)';
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
