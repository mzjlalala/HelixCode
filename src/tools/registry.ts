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

// ── Handler types ──────────────────────────────────────────────

export interface SafeToolContext {
  cwd: string;
  signal: AbortSignal | undefined;
  /** Callback for update_plan (agent-owned state) */
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

export interface RegisteredTool {
  definition: ToolDefinition;
  /** Execute for safe (non-confirmable) tools */
  execute?: SafeToolHandler;
  /** Execute for confirmed tools (after user approval) */
  executeConfirmed?: ConfirmedToolHandler;
  /** Preview for confirmed tools (shown to user before approval) */
  preview?: ToolPreviewHandler;
  /** If true, this confirmed tool needs special shell-risk handling */
  shellRisk?: boolean;
}

// ── Tool Registry ──────────────────────────────────────────────

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private updatePlanFn: ((args: Record<string, unknown>) => string) | null = null;

  /** Inject the agent-owned update_plan handler after construction. */
  setUpdatePlan(fn: (args: Record<string, unknown>) => string): void {
    this.updatePlanFn = fn;
  }

  register(tool: RegisteredTool): void {
    this.tools.set(tool.definition.name, tool);
  }

  /** All tool definitions for the LLM provider. */
  getDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition);
  }

  /** Returns true if this tool requires user confirmation. */
  isConfirmed(name: string): boolean {
    return this.tools.get(name)?.definition.confirm === true;
  }

  /** True if this confirmed tool needs shell-risk inspection before confirmation. */
  hasShellRisk(name: string): boolean {
    return this.tools.get(name)?.shellRisk === true;
  }

  /** Execute a safe (non-confirmable) tool; returns JSON-stringified observation. */
  async executeSafe(
    name: string,
    cwd: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool?.execute) {
      // update_plan is special: it lives in the agent
      if (name === 'update_plan' && this.updatePlanFn) {
        return this.updatePlanFn(args);
      }
      return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` });
    }
    return tool.execute({ cwd, signal }, args);
  }

  /** Execute a confirmed tool (after user approval). */
  async executeConfirmed(name: string, cwd: string, args: Record<string, unknown>): Promise<ConfirmedToolResult> {
    const tool = this.tools.get(name);
    if (!tool?.executeConfirmed) {
      return { ok: false, error: `Unknown confirmed tool: ${name}` };
    }
    return tool.executeConfirmed(cwd, args);
  }

  /** Generate a preview string for the confirmation UI. */
  async preview(name: string, cwd: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool?.preview) return `Execute ${name}`;
    return await tool.preview(cwd, args);
  }
}

// ── Default registry factory ───────────────────────────────────

export function createDefaultRegistry(): ToolRegistry {
  const r = new ToolRegistry();

  // ── Safe tools ────────────────────────────────────────────

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
    // No execute handler — dispatched via onUpdatePlan callback
  });

  r.register({
    definition: {
      name: 'web_search',
      description: 'Search the web via Bing. No API key required.',
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

  // ── Confirmed tools ───────────────────────────────────────

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

// ── Shared preview helpers ────────────────────────────────────

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

