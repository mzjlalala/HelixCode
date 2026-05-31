import { copyFile, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';

export interface UndoEntry {
  path: string;
  backupPath: string;
  tool: string;
  timestamp: number;
}

const undoStack: UndoEntry[] = [];

const UNDO_DIR = '.helix/undo';

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

/** Create a backup of a file before it's modified. Returns the backup path, or null if the file doesn't exist (new file). */
export async function backupFile(cwd: string, path: string, tool: string): Promise<UndoEntry | null> {
  const target = resolve(cwd, path);
  try {
    await readFile(target, 'utf8');
  } catch {
    // File doesn't exist — nothing to backup
    return null;
  }

  const backupDir = resolve(cwd, UNDO_DIR);
  await mkdir(backupDir, { recursive: true });

  const backupName = `${path.replace(/[/\\]/g, '_')}-${timestamp()}.bak`;
  const backupPath = resolve(backupDir, backupName);
  await copyFile(target, backupPath);

  const entry: UndoEntry = { path, backupPath, tool, timestamp: Date.now() };
  undoStack.push(entry);
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

    // Clean up the backup file
    await unlink(entry.backupPath).catch(() => {});

    return { ok: true, entry };
  } catch (error) {
    // Push back on failure so user can retry
    undoStack.push(entry);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Get the undo stack for display */
export function getUndoStack(): UndoEntry[] {
  return [...undoStack];
}
