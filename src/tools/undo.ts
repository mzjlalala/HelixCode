/**
 * 撤销栈：在写文件/替换/编辑/打补丁前备份，支持会话间持久化与 undo 恢复。
 */

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

/** 从统一 diff 的 diff --git 行提取受影响的相对路径 */
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

/** 从磁盘加载持久化的撤销栈（会话开始时调用一次） */
export async function loadUndoStack(cwd: string): Promise<void> {
  try {
    const content = await readFile(resolve(cwd, STACK_FILE), 'utf8');
    const parsed = JSON.parse(content) as UndoEntry[];
    if (!Array.isArray(parsed)) return;
    undoStack.splice(0, undoStack.length, ...parsed.filter(isUndoEntry));
  } catch {
    // 尚无栈文件 — 保持空栈
  }
}

async function persistUndoStack(cwd: string): Promise<void> {
  const target = resolve(cwd, STACK_FILE);
  await mkdir(resolve(cwd, '.helix'), { recursive: true });
  await writeFile(target, JSON.stringify(undoStack, null, 2) + '\n', 'utf8');
}

/**
 * 修改前备份文件；新文件不存在时返回 null。
 * 备份写入 .helix/undo/ 并压入栈。
 */
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

/** 查看栈顶撤销项，不弹出 */
export function peekUndo(): UndoEntry | null {
  return undoStack.length > 0 ? (undoStack[undoStack.length - 1] ?? null) : null;
}

/** 用最近备份覆盖原文件并弹出栈顶；失败时重新压栈 */
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

/** 返回撤销栈副本（供 UI 展示） */
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
