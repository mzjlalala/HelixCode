import type { AgentTurnResult } from './terminal-agent.js';
import { readFileTool, replaceInFileTool, writeFileTool } from '../tools/filesystem.js';
import { applyPatchTool } from '../tools/patch.js';
import { runShellCommand } from '../tools/shell.js';
import { classifyShellCommand } from '../tools/shell.js';
import { countTextLines, createCompactTextDiff } from '../tools/text-diff.js';

type Confirmation = Extract<AgentTurnResult, { type: 'confirmation' }>;

export async function previewConfirmedTool(cwd: string, confirmation: Confirmation): Promise<string> {
  if (confirmation.tool === 'write_file') {
    return previewWriteFile(cwd, confirmation);
  }
  if (confirmation.tool === 'apply_patch') {
    return previewPatch(confirmation);
  }
  if (confirmation.tool === 'replace_in_file') {
    return previewReplaceInFile(cwd, confirmation);
  }
  return previewShell(cwd, confirmation);
}

export async function executeConfirmedTool(
  cwd: string,
  confirmation: Confirmation
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  if (confirmation.tool === 'write_file') {
    const result = await writeFileTool(cwd, {
      path: confirmation.args.path,
      content: confirmation.args.content
    });
    if (!result.ok) return result;
    return { ok: true, output: `Wrote ${result.path}` };
  }

  if (confirmation.tool === 'apply_patch') {
    return applyPatchTool(cwd, { patch: confirmation.args.patch });
  }

  if (confirmation.tool === 'replace_in_file') {
    const result = await replaceInFileTool(cwd, {
      path: confirmation.args.path,
      oldText: confirmation.args.oldText,
      newText: confirmation.args.newText,
      replaceAll: confirmation.args.replaceAll
    });
    if (!result.ok) return result;
    return { ok: true, output: `Replaced ${result.replacements} match(es) in ${result.path}` };
  }

  const command = String(confirmation.args.command ?? '');
  const result = await runShellCommand(cwd, command);
  if (!result.ok) return result;
  return {
    ok: true,
    output: [result.stdout, result.stderr].filter(Boolean).join('\n')
  };
}

async function previewWriteFile(cwd: string, confirmation: Confirmation): Promise<string> {
  const path = String(confirmation.args.path ?? '');
  const content = typeof confirmation.args.content === 'string' ? confirmation.args.content : '';
  const current = await readFileTool(cwd, { path });
  const status = current.ok ? 'overwrite' : 'create';
  const before = current.ok ? current.content : '';

  return [
    'Tool: write_file',
    `Target: ${path || '(missing path)'}`,
    `Status: ${status}`,
    `Lines: ${countTextLines(content)}`,
    'Preview:',
    createCompactTextDiff(before, content)
  ].join('\n');
}

function previewPatch(confirmation: Confirmation): string {
  const patch = typeof confirmation.args.patch === 'string' ? confirmation.args.patch : '';
  const files = affectedPatchFiles(patch);
  const previewLines = patch.split(/\r?\n/).slice(0, 40);
  if (patch.split(/\r?\n/).length > 40) previewLines.push('... patch preview truncated');

  return [
    'Tool: apply_patch',
    `Files: ${files.length ? files.join(', ') : 'unknown'}`,
    'Preview:',
    ...previewLines
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
    'Tool: replace_in_file',
    `Target: ${path || '(missing path)'}`,
    `Replacements: ${replacements}`,
    'Preview:',
    createCompactTextDiff(before, after)
  ].join('\n');
}

function previewShell(cwd: string, confirmation: Confirmation): string {
  const command = String(confirmation.args.command ?? '');
  const risk = classifyShellCommand(command);
  return [
    'Tool: run_shell',
    `Cwd: ${cwd}`,
    `Command: ${command}`,
    `Risk: ${risk.risk === 'blocked' ? risk.reason ?? 'blocked' : 'requires confirmation'}`
  ].join('\n');
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
