/**
 * 工具注册表：将 LLM 可调用的工具名映射到定义、执行器与确认预览。
 * createDefaultRegistry 注册 HelixCode 内置的全部 Agent 工具。
 */

import type { ToolDefinition } from '../llm/types.js';
import { WEB_SEARCH_MAX_COUNT } from '../core/constants.js';
import { readFileTool, searchFilesTool, listFilesTool, writeFileTool, replaceInFileTool, editFileTool } from './filesystem.js';
import { gitStatusTool, gitDiffTool } from './git.js';
import { applyPatchTool } from './patch.js';
import { runShellCommand, classifyShellCommand } from './shell.js';
import { webSearchTool, webFetchTool } from './web.js';
import { countTextLines, createCompactTextDiff } from './text-diff.js';
import { backupFile, affectedPatchFiles } from './undo.js';
import { style } from '../cli/style.js';

// ── 处理器类型 ──────────────────────────────────────────────

/** 无需用户确认即可执行的工具上下文 */
export interface SafeToolContext {
  cwd: string;
  signal: AbortSignal | undefined;
  /** update_plan 由 Agent 注入的状态回调 */
  onUpdatePlan?: (args: Record<string, unknown>) => string;
}

export type SafeToolHandler = (ctx: SafeToolContext, args: Record<string, unknown>) => Promise<string>;

export type ConfirmedToolResult =
  | { ok: true; output: string }
  | { ok: false; error: string };

export type ConfirmedToolHandler = (
  cwd: string,
  args: Record<string, unknown>
) => Promise<ConfirmedToolResult>;

export type ToolPreviewHandler = (
  cwd: string,
  args: Record<string, unknown>
) => string | Promise<string>;

/** 单个已注册工具：定义 + 可选的执行/确认/预览处理器 */
export interface RegisteredTool {
  definition: ToolDefinition;
  /** 安全工具：直接执行 */
  execute?: SafeToolHandler;
  /** 需确认工具：用户批准后执行 */
  executeConfirmed?: ConfirmedToolHandler;
  /** 需确认工具：批准前展示的预览文本 */
  preview?: ToolPreviewHandler;
  /** 为 true 时确认前需额外做 shell 风险检查（如 run_shell） */
  shellRisk?: boolean;
}

// ── 工具注册表 ──────────────────────────────────────────────

/**
 * 工具名 → RegisteredTool 的注册中心。
 * 区分「安全工具」（executeSafe）与「需确认工具」（preview + executeConfirmed）。
 */
export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private updatePlanFn: ((args: Record<string, unknown>) => string) | null = null;

  /** 注入 Agent 持有的 update_plan 处理器（构造后调用） */
  setUpdatePlan(fn: (args: Record<string, unknown>) => string): void {
    this.updatePlanFn = fn;
  }

  /** 注册或覆盖同名工具 */
  register(tool: RegisteredTool): void {
    this.tools.set(tool.definition.name, tool);
  }

  /** 返回供 LLM 使用的全部工具 schema 定义 */
  getDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition);
  }

  /** 该工具是否需要用户确认 */
  isConfirmed(name: string): boolean {
    return this.tools.get(name)?.definition.confirm === true;
  }

  /** 确认前是否需做 shell 风险分级（run_shell） */
  hasShellRisk(name: string): boolean {
    return this.tools.get(name)?.shellRisk === true;
  }

  /** 执行安全工具，返回 JSON 字符串形式的观测结果 */
  async executeSafe(
    name: string,
    cwd: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool?.execute) {
      // update_plan 无 execute，由 Agent 通过 setUpdatePlan 注入
      if (name === 'update_plan' && this.updatePlanFn) {
        return this.updatePlanFn(args);
      }
      return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` });
    }
    return tool.execute({ cwd, signal }, args);
  }

  /** 用户批准后执行需确认工具 */
  async executeConfirmed(name: string, cwd: string, args: Record<string, unknown>): Promise<ConfirmedToolResult> {
    const tool = this.tools.get(name);
    if (!tool?.executeConfirmed) {
      return { ok: false, error: `Unknown confirmed tool: ${name}` };
    }
    return tool.executeConfirmed(cwd, args);
  }

  /** 生成确认 UI 中展示的预览文本 */
  async preview(name: string, cwd: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool?.preview) return `Execute ${name}`;
    return await tool.preview(cwd, args);
  }
}

// ── 默认注册表工厂 ───────────────────────────────────────────

/**
 * 创建并填充内置工具注册表：
 * 安全工具（读/搜/列/git/网页/plan）与需确认工具（写/替换/编辑/补丁/shell）。
 */
export function createDefaultRegistry(): ToolRegistry {
  const r = new ToolRegistry();

  // ── 安全工具（无需确认）────────────────────────────────

  r.register({
    definition: {
      name: 'read_file',
      description: 'Read a project file, optionally by line range',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root' },
          startLine: { type: 'number', description: 'Optional start line (1-based)' },
          endLine: { type: 'number', description: 'Optional end line (inclusive)' }
        },
        required: ['path']
      }
    },
    execute: async (ctx, args) => {
      const result = await readFileTool(ctx.cwd,
        { path: args.path, startLine: args.startLine, endLine: args.endLine },
        ctx.signal
      );
      return JSON.stringify(result);
    }
  });

  r.register({
    definition: {
      name: 'search_files',
      description: 'Search file contents with optional glob, case sensitivity, result limits, and context lines',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to search for' },
          glob: { type: 'string', description: 'Optional glob pattern (e.g. *.ts)' },
          caseSensitive: { type: 'boolean', description: 'Case sensitive search' },
          maxResults: { type: 'number', description: 'Maximum results to return' },
          contextLines: { type: 'number', description: 'Lines of context around each match' }
        },
        required: ['query']
      }
    },
    execute: async (ctx, args) => {
      const result = await searchFilesTool(ctx.cwd, {
        query: args.query,
        glob: args.glob,
        caseSensitive: args.caseSensitive,
        maxResults: args.maxResults,
        contextLines: args.contextLines
      }, ctx.signal);
      return JSON.stringify(result);
    }
  });

  r.register({
    definition: {
      name: 'list_files',
      description: "List all project files (excluding .git, node_modules, dist)",
      parameters: { type: 'object', properties: {} }
    },
    execute: async (ctx) => {
      const result = await listFilesTool(ctx.cwd, ctx.signal);
      return JSON.stringify(result);
    }
  });

  r.register({
    definition: {
      name: 'git_status',
      description: 'Show git working tree status',
      parameters: { type: 'object', properties: {} }
    },
    execute: async (ctx) => await gitStatusTool(ctx.cwd, ctx.signal)
  });

  r.register({
    definition: {
      name: 'git_diff',
      description: 'Show git diff (unstaged changes)',
      parameters: { type: 'object', properties: {} }
    },
    execute: async (ctx) => await gitDiffTool(ctx.cwd, ctx.signal)
  });

  r.register({
    definition: {
      name: 'update_plan',
      description: 'Track multi-step work by setting plan items with pending/in_progress/completed status',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                step: { type: 'string' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] }
              },
              required: ['step', 'status']
            }
          }
        },
        required: ['items']
      }
    }
    // 无 execute，由 Agent 的 setUpdatePlan / onUpdatePlan 分发
  });

  r.register({
    definition: {
      name: 'web_search',
      description:
        'Search the web via Tavily (TAVILY_API_KEY) or Bing/HTML fallback. Use the user language in queries. Returns noResults/duplicateQuery hints.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          count: { type: 'number', description: `Number of results (max ${WEB_SEARCH_MAX_COUNT})` }
        },
        required: ['query']
      }
    },
    execute: async (ctx, args) => {
      const result = await webSearchTool(
        String(args.query ?? ''),
        typeof args.count === 'number' ? args.count : undefined
      );
      return JSON.stringify(result);
    }
  });

  r.register({
    definition: {
      name: 'web_fetch',
      description: 'Fetch a URL and return its readable text content. No API key required.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' }
        },
        required: ['url']
      }
    },
    execute: async (ctx, args) => {
      const result = await webFetchTool(String(args.url ?? ''));
      return JSON.stringify(result);
    }
  });

  // ── 需确认工具（写盘 / shell 等）────────────────────────

  r.register({
    definition: {
      name: 'write_file',
      description: 'Write content to a file (requires user confirmation)',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root' },
          content: { type: 'string', description: 'File content to write' }
        },
        required: ['path', 'content']
      },
      confirm: true
    },
    executeConfirmed: async (cwd, args) => {
      const path = String(args.path ?? '');
      await backupFile(cwd, path, 'write_file');
      const result = await writeFileTool(cwd, { path, content: args.content });
      if (!result.ok) return result;
      return { ok: true, output: `Wrote ${result.path}` };
    },
    preview: async (cwd, args) => {
      const path = String(args.path ?? '');
      const content = typeof args.content === 'string' ? args.content : '';
      const current = await readFileTool(cwd, { path });
      const status = current.ok ? 'overwrite' : 'create';
      const before = current.ok ? current.content : '';
      return [
        style.dim(`${style.label('┃')} ${fmtPath(path || '(missing path)')}  ${style.dim(`(${status}, ${countTextLines(content)} lines)`)}`),
        fmtDiff(createCompactTextDiff(before, content))
      ].join('\n');
    }
  });

  r.register({
    definition: {
      name: 'replace_in_file',
      description: 'Replace exact text in a file (requires user confirmation)',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          oldText: { type: 'string', description: 'Exact text to replace' },
          newText: { type: 'string', description: 'Replacement text' },
          replaceAll: { type: 'boolean', description: 'Replace all occurrences' }
        },
        required: ['path', 'oldText', 'newText']
      },
      confirm: true
    },
    executeConfirmed: async (cwd, args) => {
      const path = String(args.path ?? '');
      await backupFile(cwd, path, 'replace_in_file');
      const result = await replaceInFileTool(cwd, {
        path, oldText: args.oldText, newText: args.newText, replaceAll: args.replaceAll
      });
      if (!result.ok) return result;
      return { ok: true, output: `Replaced ${result.replacements} match(es) in ${result.path}` };
    },
    preview: async (cwd, args) => {
      const path = String(args.path ?? '');
      const oldText = typeof args.oldText === 'string' ? args.oldText : '';
      const newText = typeof args.newText === 'string' ? args.newText : '';
      const current = await readFileTool(cwd, { path });
      const before = current.ok ? current.content : '';
      const replacements = oldText ? before.split(oldText).length - 1 : 0;
      const after = oldText
        ? args.replaceAll === true
          ? before.split(oldText).join(newText)
          : before.replace(oldText, newText)
        : before;
      return [
        style.dim(`${style.label('┃')} ${fmtPath(path || '(missing path)')}  ${style.dim(`(${replacements} match${replacements !== 1 ? 'es' : ''})`)}`),
        fmtDiff(createCompactTextDiff(before, after))
      ].join('\n');
    }
  });

  r.register({
    definition: {
      name: 'edit_file',
      description: 'Replace an inclusive line range in a file (requires user confirmation)',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          startLine: { type: 'number', description: 'Start line (1-based)' },
          endLine: { type: 'number', description: 'End line (inclusive)' },
          content: { type: 'string', description: 'Replacement content' }
        },
        required: ['path', 'startLine', 'endLine', 'content']
      },
      confirm: true
    },
    executeConfirmed: async (cwd, args) => {
      const path = String(args.path ?? '');
      await backupFile(cwd, path, 'edit_file');
      const result = await editFileTool(cwd, {
        path, startLine: args.startLine, endLine: args.endLine, content: args.content
      });
      if (!result.ok) return result;
      return { ok: true, output: `Edited ${result.path} lines ${String(args.startLine)}-${String(args.endLine)}` };
    },
    preview: async (cwd, args) => {
      const path = String(args.path ?? '');
      const startLine = Number(args.startLine);
      const endLine = Number(args.endLine);
      const content = typeof args.content === 'string' ? args.content : '';
      const current = await readFileTool(cwd, { path });
      const before = current.ok ? current.content : '';
      const lines = before.replace(/\r\n/g, '\n').split('\n');
      const replacement = content.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
      const afterLines = [...lines];
      if (Number.isInteger(startLine) && Number.isInteger(endLine) && startLine > 0 && endLine >= startLine) {
        afterLines.splice(startLine - 1, endLine - startLine + 1, ...replacement);
      }
      return [
        style.dim(`${style.label('┃')} ${fmtPath(path || '(missing path)')}  ${style.dim(`lines ${Number.isFinite(startLine) ? startLine : '?'}-${Number.isFinite(endLine) ? endLine : '?'}`)}`),
        fmtDiff(createCompactTextDiff(before, afterLines.join('\n')))
      ].join('\n');
    }
  });

  r.register({
    definition: {
      name: 'apply_patch',
      description: 'Apply a unified diff via git apply (requires user confirmation)',
      parameters: {
        type: 'object',
        properties: {
          patch: { type: 'string', description: 'Unified diff to apply' }
        },
        required: ['patch']
      },
      confirm: true
    },
    executeConfirmed: async (cwd, args) => {
      const patch = String(args.patch ?? '');
      for (const f of affectedPatchFiles(patch)) {
        await backupFile(cwd, f, 'apply_patch');
      }
      return applyPatchTool(cwd, { patch });
    },
    preview: (_cwd, args) => {
      const patch = typeof args.patch === 'string' ? args.patch : '';
      const files = affectedPatchFiles(patch);
      const allLines = patch.split(/\r?\n/);
      const previewLines = allLines.slice(0, 40);
      if (allLines.length > 40) previewLines.push(style.dim('... patch preview truncated'));
      return [
        style.dim(`${style.label('┃')} ${fmtPath(files.length ? files.join(', ') : 'unknown')}`),
        ...previewLines.map((l) => fmtDiff(l))
      ].join('\n');
    }
  });

  r.register({
    definition: {
      name: 'run_shell',
      description: 'Run a shell command (requires user confirmation; destructive commands are blocked)',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run' }
        },
        required: ['command']
      },
      confirm: true
    },
    shellRisk: true,
    executeConfirmed: async (cwd, args) => {
      const command = String(args.command ?? '');
      const result = await runShellCommand(cwd, command);
      if (!result.ok) return result;
      return { ok: true, output: [result.stdout, result.stderr].filter(Boolean).join('\n') };
    },
    preview: (_cwd, args) => {
      const command = String(args.command ?? '');
      const risk = classifyShellCommand(command);
      const riskStyle = risk.risk === 'blocked' ? style.red : style.yellow;
      return style.dim(
        `${style.label('┃')} ${command}  ${riskStyle(risk.risk === 'blocked' ? (risk.reason ?? 'blocked') : 'requires confirmation')}`
      );
    }
  });

  return r;
}

// ── 确认预览用的格式化辅助 ────────────────────────────────────

function fmtPath(p: string): string {
  return style.cyan(p);
}

function fmtDiff(content: string): string {
  return content.split('\n')
    .map((line) => {
      if (line.startsWith('+')) return style.green(line);
      if (line.startsWith('-')) return style.red(line);
      if (line.startsWith('@@')) return style.cyan(line);
      return line;
    })
    .join('\n');
}

