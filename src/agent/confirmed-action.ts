import type { AgentTurnResult } from './terminal-agent.js';
import { editFileTool, readFileTool, replaceInFileTool, writeFileTool } from '../tools/filesystem.js';
import { applyPatchTool } from '../tools/patch.js';
import { runShellCommand } from '../tools/shell.js';
import { classifyShellCommand } from '../tools/shell.js';
import { countTextLines, createCompactTextDiff } from '../tools/text-diff.js';
import { style } from '../cli/style.js';

type Confirmation = Extract<AgentTurnResult, { type: 'confirmation' }>;
type ConfirmedToolResult = { ok: true; output: string } | { ok: false; error: string };

const previewHandlers: Record<string, (cwd: string, c: Confirmation) => string | Promise<string>> = {
  write_file: previewWriteFile,
  replace_in_file: previewReplaceInFile,
  edit_file: previewEditFile,
  apply_patch: (_cwd, c) => previewPatch(c),
};

export async function previewConfirmedTool(cwd: string, confirmation: Confirmation): Promise<string> {
  const handler = previewHandlers[confirmation.tool] ?? previewShell;
  return await handler(cwd, confirmation);
}

const executeHandlers: Record<string, (cwd: string, c: Confirmation) => Promise<ConfirmedToolResult>> = {
  write_file: async (cwd, c) => {
    const result = await writeFileTool(cwd, { path: c.args.path, content: c.args.content });
    if (!result.ok) return result;
    return { ok: true, output: `Wrote ${result.path}` };
  },
  apply_patch: async (cwd, c) => applyPatchTool(cwd, { patch: c.args.patch }),
  replace_in_file: async (cwd, c) => {
    const result = await replaceInFileTool(cwd, {
      path: c.args.path, oldText: c.args.oldText, newText: c.args.newText, replaceAll: c.args.replaceAll
    });
    if (!result.ok) return result;
    return { ok: true, output: `Replaced ${result.replacements} match(es) in ${result.path}` };
  },
  edit_file: async (cwd, c) => {
    const result = await editFileTool(cwd, { path: c.args.path, startLine: c.args.startLine, endLine: c.args.endLine, content: c.args.content });
    if (!result.ok) return result;
    return { ok: true, output: `Edited ${result.path} lines ${String(c.args.startLine)}-${String(c.args.endLine)}` };
  },
  run_shell: async (cwd, c) => {
    const command = String(c.args.command ?? '');
    const result = await runShellCommand(cwd, command);
    if (!result.ok) return result;
    return { ok: true, output: [result.stdout, result.stderr].filter(Boolean).join('\n') };
  },
};

export async function executeConfirmedTool(cwd: string, confirmation: Confirmation): Promise<ConfirmedToolResult> {
  const handler = executeHandlers[confirmation.tool];
  return handler!(cwd, confirmation);
}

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

async function previewWriteFile(cwd: string, confirmation: Confirmation): Promise<string> {
  const path = String(confirmation.args.path ?? '');
  const content = typeof confirmation.args.content === 'string' ? confirmation.args.content : '';
  const current = await readFileTool(cwd, { path });
  const status = current.ok ? 'overwrite' : 'create';
  const before = current.ok ? current.content : '';

  return [
    style.dim(`${style.label('┃')} ${fmtPath(path || '(missing path)')}  ${style.dim(`(${status}, ${countTextLines(content)} lines)`)}`),
    fmtDiff(createCompactTextDiff(before, content))
  ].join('\n');
}

function previewPatch(confirmation: Confirmation): string {
  const patch = typeof confirmation.args.patch === 'string' ? confirmation.args.patch : '';
  const files = affectedPatchFiles(patch);
  const previewLines = patch.split(/\r?\n/).slice(0, 40);
  if (patch.split(/\r?\n/).length > 40) previewLines.push(style.dim('... patch preview truncated'));

  return [
    style.dim(`${style.label('┃')} ${fmtPath(files.length ? files.join(', ') : 'unknown')}`),
    ...previewLines.map((l) => fmtDiff(l))
  ].join('\n');
}

async function previewReplaceInFile(cwd: string, confirmation: Confirmation): Promise<string> {
  const path = String(confirmation.args.path ?? '');
  const oldText = typeof confirmation.args.oldText === 'string' ? confirmation.args.oldText : '';
  const newText = typeof confirmation.args.newText === 'string' ? confirmation.args.newText : '';
  const current = await readFileTool(cwd, { path });
  const before = current.ok ? current.content : '';
  const replacements = oldText ? before.split(oldText).length - 1 : 0;
  const after = oldText
    ? confirmation.args.replaceAll === true
      ? before.split(oldText).join(newText)
      : before.replace(oldText, newText)
    : before;

  return [
    style.dim(`${style.label('┃')} ${fmtPath(path || '(missing path)')}  ${style.dim(`(${replacements} match${replacements !== 1 ? 'es' : ''})`)}`),
    fmtDiff(createCompactTextDiff(before, after))
  ].join('\n');
}

async function previewEditFile(cwd: string, confirmation: Confirmation): Promise<string> {
  const path = String(confirmation.args.path ?? '');
  const startLine = Number(confirmation.args.startLine);
  const endLine = Number(confirmation.args.endLine);
  const content = typeof confirmation.args.content === 'string' ? confirmation.args.content : '';
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

function previewShell(cwd: string, confirmation: Confirmation): string {
  const command = String(confirmation.args.command ?? '');
  const risk = classifyShellCommand(command);
  const riskStyle = risk.risk === 'blocked' ? style.red : style.yellow;
  return style.dim(`${style.label('┃')} ${command}  ${riskStyle(risk.risk === 'blocked' ? (risk.reason ?? 'blocked') : 'requires confirmation')}`);
}

function affectedPatchFiles(patch: string): string[] {
  const files = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    if (!line.startsWith('diff --git ')) continue;
    const parts = line.slice('diff --git '.length).split(/\s+/).filter(Boolean);
    const candidate = parts[1] ?? parts[0];
    if (!candidate) continue;
    files.add(candidate.replace(/^"|"$/g, '').replace(/^[ab]\//, ''));
  }
  return [...files];
}
