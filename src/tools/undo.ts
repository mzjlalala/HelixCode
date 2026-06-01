import { copyFile, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface UndoEntry {
  path: string;
  backupPath: string;
  tool: string;
  timestamp: number;
}

const undoStack: UndoEntry[] = [];
const UNDO_DIR = '.helix/undo';
const STACK_FILE = '.helix/undo-stack.json';

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/** Extract affected file paths from a unified diff patch header */
export function affectedPatchFiles(patch: string): string[] {
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

/** Load persisted undo stack from disk (call once at session start). */
export async function loadUndoStack(cwd: string): Promise<void> {
  try {
    const content = await readFile(resolve(cwd, STACK_FILE), 'utf8');
    const parsed = JSON.parse(content) as UndoEntry[];
    if (!Array.isArray(parsed)) return;
    undoStack.splice(0, undoStack.length, ...parsed.filter(isUndoEntry));
  } catch {
    // No stack yet — start empty
  }
}

async function persistUndoStack(cwd: string): Promise<void> {
  const target = resolve(cwd, STACK_FILE);
  await mkdir(resolve(cwd, '.helix'), { recursive: true });
  await writeFile(target, JSON.stringify(undoStack, null, 2) + '\n', 'utf8');
}

/** Create a backup of a file before it's modified. Returns the backup path, or null if the file doesn't exist (new file). */
export async function backupFile(cwd: string, path: string, tool: string): Promise<UndoEntry | null> {
  const target = resolve(cwd, path);
  try {
    await readFile(target, 'utf8');
  } catch {
    return null;
  }

  const backupDir = resolve(cwd, UNDO_DIR);
  await mkdir(backupDir, { recursive: true });

  const backupName = `${path.replace(/[/\\]/g, '_')}-${timestamp()}.bak`;
  const backupPath = resolve(backupDir, backupName);
  await copyFile(target, backupPath);

  const entry: UndoEntry = { path, backupPath, tool, timestamp: Date.now() };
  undoStack.push(entry);
  await persistUndoStack(cwd);
  return entry;
}

/** Get the most recent undo entry, or null */
export function peekUndo(): UndoEntry | null {
  return undoStack.length > 0 ? (undoStack[undoStack.length - 1] ?? null) : null;
}

/** Restore the most recent backup and pop the stack */
export async function undoLast(cwd: string): Promise<{ ok: true; entry: UndoEntry } | { ok: false; error: string }> {
  const entry = undoStack.pop();
  if (!entry) return { ok: false, error: 'Nothing to undo.' };

  try {
    const content = await readFile(entry.backupPath, 'utf8');
    await writeFile(resolve(cwd, entry.path), content, 'utf8');
    await unlink(entry.backupPath).catch(() => {});
    await persistUndoStack(cwd);
    return { ok: true, entry };
  } catch (error) {
    undoStack.push(entry);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Get the undo stack for display */
export function getUndoStack(): UndoEntry[] {
  return [...undoStack];
}

function isUndoEntry(value: unknown): value is UndoEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const e = value as Partial<UndoEntry>;
  return typeof e.path === 'string'
    && typeof e.backupPath === 'string'
    && typeof e.tool === 'string'
    && typeof e.timestamp === 'number';
}
