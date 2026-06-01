/**
 * 文件系统工具：读/写/替换/按行编辑、列举与搜索项目内文件。
 * 所有路径均限制在工作区根目录内，防止越界访问。
 */

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, extname, relative, resolve } from 'node:path';
import picomatch from 'picomatch';
import {
  BINARY_EXTENSIONS,
  DEFAULT_SEARCH_MAX_RESULTS,
  IGNORED_DIRS,
  MAX_SEARCH_FILE_BYTES
} from '../core/constants.js';

const execFileAsync = promisify(execFile);

/** 单文件读/写类工具的通用结果 */
export type FileToolResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

/** 单次搜索命中：路径、行号、匹配行及可选上下文 */
export interface SearchMatch {
  path: string;
  line: number;
  text: string;
  before?: string[];
  after?: string[];
}

export type SearchToolResult =
  | { ok: true; matches: SearchMatch[] }
  | { ok: false; error: string };

/** 将相对路径解析为绝对路径，并拒绝逃出项目根目录 */
function resolveInsideProject(cwd: string, inputPath: string): FileToolResult {
  const root = resolve(cwd);
  const target = resolve(root, inputPath);
  const rel = relative(root, target);

  if (rel === '' || rel.startsWith('..') || resolve(target) === resolve(root, '..')) {
    return { ok: false, error: `Path is outside project: ${inputPath}` };
  }

  return { ok: true, content: target };
}

/** 读取项目内文件，可选按 1-based 行号区间截取 */
export async function readFileTool(
  cwd: string,
  args: { path?: unknown; startLine?: unknown; endLine?: unknown },
  signal?: AbortSignal
): Promise<FileToolResult> {
  if (signal?.aborted) return { ok: false, error: 'Interrupted.' };
  if (typeof args.path !== 'string' || !args.path.trim()) {
    return { ok: false, error: 'read_file requires a string path.' };
  }

  const resolved = resolveInsideProject(cwd, args.path);
  if (!resolved.ok) return resolved;

  try {
    const content = await readFile(resolved.content, 'utf8');
    const ranged = selectLineRange(content, args.startLine, args.endLine);
    if (!ranged.ok) return ranged;
    return { ok: true, content: ranged.content };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 写入文件（自动创建父目录） */
export async function writeFileTool(
  cwd: string,
  args: { path?: unknown; content?: unknown }
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (typeof args.path !== 'string' || !args.path.trim()) {
    return { ok: false, error: 'write_file requires a string path.' };
  }
  if (typeof args.content !== 'string') {
    return { ok: false, error: 'write_file requires string content.' };
  }

  const resolved = resolveInsideProject(cwd, args.path);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  try {
    await mkdir(dirname(resolved.content), { recursive: true });
    await writeFile(resolved.content, args.content, 'utf8');
    return { ok: true, path: args.path };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 精确文本替换；多处匹配时需 replaceAll=true */
export async function replaceInFileTool(
  cwd: string,
  args: { path?: unknown; oldText?: unknown; newText?: unknown; replaceAll?: unknown }
): Promise<{ ok: true; path: string; replacements: number } | { ok: false; error: string }> {
  if (typeof args.path !== 'string' || !args.path.trim()) {
    return { ok: false, error: 'replace_in_file requires a string path.' };
  }
  if (typeof args.oldText !== 'string' || !args.oldText) {
    return { ok: false, error: 'replace_in_file requires non-empty oldText.' };
  }
  if (typeof args.newText !== 'string') {
    return { ok: false, error: 'replace_in_file requires string newText.' };
  }

  const current = await readFileTool(cwd, { path: args.path });
  if (!current.ok) return { ok: false, error: current.error };

  const matches = countOccurrences(current.content, args.oldText);
  if (matches === 0) {
    return {
      ok: false,
      error: `Text to replace was not found in ${args.path}: ${JSON.stringify(args.oldText)}. Check exact whitespace/casing or read the file again before retrying.`
    };
  }
  if (matches > 1 && args.replaceAll !== true) {
    return { ok: false, error: `oldText matched ${matches} times. Set replaceAll to true to replace all matches.` };
  }

  const content = args.replaceAll === true
    ? current.content.split(args.oldText).join(args.newText)
    : current.content.replace(args.oldText, args.newText);
  const written = await writeFileTool(cwd, { path: args.path, content });
  if (!written.ok) return written;
  return { ok: true, path: args.path, replacements: args.replaceAll === true ? matches : 1 };
}

/** 按 inclusive 行号区间替换为多行内容 */
export async function editFileTool(
  cwd: string,
  args: { path?: unknown; startLine?: unknown; endLine?: unknown; content?: unknown }
): Promise<{ ok: true; path: string; linesChanged: number } | { ok: false; error: string }> {
  if (typeof args.path !== 'string' || !args.path.trim()) {
    return { ok: false, error: 'edit_file requires a string path.' };
  }
  if (typeof args.content !== 'string') {
    return { ok: false, error: 'edit_file requires string content.' };
  }
  const startLine = positiveInteger(args.startLine, 0);
  const endLine = positiveInteger(args.endLine, 0);
  if (!startLine || !endLine) {
    return { ok: false, error: 'edit_file requires positive integer startLine and endLine.' };
  }
  if (endLine < startLine) {
    return { ok: false, error: 'endLine must be greater than or equal to startLine.' };
  }

  const current = await readFileTool(cwd, { path: args.path });
  if (!current.ok) return { ok: false, error: current.error };

  const normalized = current.content.replace(/\r\n/g, '\n');
  const hadTrailingNewline = normalized.endsWith('\n');
  const lines = normalized.replace(/\n$/, '').split('\n');
  if (startLine > lines.length + 1) {
    return { ok: false, error: `startLine ${startLine} is beyond the end of ${args.path}.` };
  }
  if (endLine > lines.length) {
    return { ok: false, error: `endLine ${endLine} is beyond the end of ${args.path}.` };
  }

  const replacement = args.content.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  lines.splice(startLine - 1, endLine - startLine + 1, ...replacement);
  const nextContent = `${lines.join('\n')}${hadTrailingNewline ? '\n' : ''}`;
  const written = await writeFileTool(cwd, { path: args.path, content: nextContent });
  if (!written.ok) return written;
  return { ok: true, path: args.path, linesChanged: endLine - startLine + 1 };
}
/** 递归遍历项目文件，跳过 IGNORED_DIRS 中的目录 */
async function walk(cwd: string, dir = '.', signal?: AbortSignal): Promise<string[]> {
  if (signal?.aborted) return [];
  const entries = await readdir(resolve(cwd, dir), { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (signal?.aborted) break;
    const child = dir === '.' ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      files.push(...await walk(cwd, child, signal));
    } else if (entry.isFile()) {
      files.push(child);
    }
  }

  return files;
}

function isSearchableTextFile(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return !BINARY_EXTENSIONS.has(ext);
}

async function isWithinSizeLimit(cwd: string, relPath: string): Promise<boolean> {
  try {
    const info = await stat(resolve(cwd, relPath));
    return info.size <= MAX_SEARCH_FILE_BYTES;
  } catch {
    return false;
  }
}

/** 列出项目内所有相对路径文件（已排序） */
export async function listFilesTool(cwd: string, signal?: AbortSignal): Promise<{ ok: true; files: string[] } | { ok: false; error: string }> {
  try {
    return { ok: true, files: (await walk(cwd, '.', signal)).sort() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 在文件内容中搜索；优先 ripgrep，不可用时回退内存扫描 */
export async function searchFilesTool(
  cwd: string,
  args: {
    query?: unknown;
    glob?: unknown;
    caseSensitive?: unknown;
    maxResults?: unknown;
    contextLines?: unknown;
  },
  signal?: AbortSignal
): Promise<SearchToolResult> {
  if (signal?.aborted) return { ok: true, matches: [] };
  if (typeof args.query !== 'string' || !args.query.trim()) {
    return { ok: false, error: 'search_files requires a string query.' };
  }

  const caseSensitive = args.caseSensitive === true;
  const maxResults = positiveInteger(args.maxResults, DEFAULT_SEARCH_MAX_RESULTS);
  const contextLines = positiveInteger(args.contextLines, 0);
  const globPattern = typeof args.glob === 'string' && args.glob.trim() ? args.glob.trim() : undefined;

  const searchOpts = {
    query: args.query,
    caseSensitive,
    maxResults,
    contextLines,
    ...(globPattern ? { glob: globPattern } : {}),
    ...(signal ? { signal } : {})
  };

  const rgResult = await searchWithRipgrep(cwd, searchOpts);
  if (rgResult) return rgResult;

  // rg 未安装或失败时，遍历文件列表做子串匹配
  return searchFilesInMemory(cwd, searchOpts);
}

async function searchWithRipgrep(
  cwd: string,
  options: {
    query: string;
    glob?: string;
    caseSensitive: boolean;
    maxResults: number;
    contextLines: number;
    signal?: AbortSignal;
  }
): Promise<SearchToolResult | null> {
  if (options.signal?.aborted) return { ok: true, matches: [] };

  const rgArgs = [
    '--json',
    '--line-number',
    '--max-count', String(options.maxResults),
    '--glob', '!node_modules/**',
    '--glob', '!.git/**',
    '--glob', '!dist/**',
    '--glob', '!coverage/**',
    '--glob', '!.helix/**'
  ];
  if (!options.caseSensitive) rgArgs.push('-i');
  if (options.glob) rgArgs.push('--glob', options.glob);
  if (options.contextLines > 0) {
    rgArgs.push('-C', String(options.contextLines));
  }
  rgArgs.push('--', options.query);

  try {
    const { stdout } = await execFileAsync('rg', rgArgs, {
      cwd,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000
    });
    return parseRipgrepJson(stdout, options.maxResults, options.contextLines);
  } catch (error) {
    const err = error as { code?: number | string; killed?: boolean; stdout?: string };
    if (err.code === 1) {
      // rg 退出码 1 表示无匹配
      return { ok: true, matches: [] };
    }
    if (err.stdout && typeof err.stdout === 'string') {
      const parsed = parseRipgrepJson(err.stdout, options.maxResults, options.contextLines);
      if (parsed.ok && parsed.matches.length > 0) return parsed;
    }
    return null;
  }
}

function parseRipgrepJson(
  stdout: string,
  maxResults: number,
  contextLines: number
): SearchToolResult {
  const matches: SearchMatch[] = [];
  const pendingContext = new Map<string, { before: string[]; after: string[] }>();

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as {
        type?: string;
        data?: {
          path?: { text?: string };
          line_number?: number;
          lines?: { text?: string };
        };
      };
      if (event.type === 'match' && event.data?.path?.text) {
        const path = event.data.path.text.replace(/\\/g, '/');
        const ctx = pendingContext.get(path);
        matches.push({
          path,
          line: event.data.line_number ?? 0,
          text: (event.data.lines?.text ?? '').replace(/\r?\n$/, ''),
          ...(contextLines > 0 && ctx ? { before: ctx.before, after: ctx.after } : {})
        });
        pendingContext.delete(path);
        if (matches.length >= maxResults) break;
      }
      if (event.type === 'context' && contextLines > 0 && event.data?.path?.text) {
        const path = event.data.path.text.replace(/\\/g, '/');
        const text = (event.data.lines?.text ?? '').replace(/\r?\n$/, '');
        const bucket = pendingContext.get(path) ?? { before: [], after: [] };
        if (matches.at(-1)?.path === path) {
          bucket.after.push(text);
        } else {
          bucket.before.push(text);
        }
        pendingContext.set(path, bucket);
      }
    } catch {
      // 跳过无法解析的 rg JSON 行
    }
  }

  return { ok: true, matches };
}

async function searchFilesInMemory(
  cwd: string,
  options: {
    query: string;
    glob?: string;
    caseSensitive: boolean;
    maxResults: number;
    contextLines: number;
    signal?: AbortSignal;
  }
): Promise<SearchToolResult> {
  const listed = await listFilesTool(cwd, options.signal);
  if (!listed.ok) return listed;

  const matches: SearchMatch[] = [];
  const needle = options.caseSensitive ? options.query : options.query.toLowerCase();

  for (const path of listed.files) {
    if (options.signal?.aborted) return { ok: true, matches };
    if (options.glob && !matchesGlob(path, options.glob)) continue;
    if (!isSearchableTextFile(path)) continue;
    if (!(await isWithinSizeLimit(cwd, path))) continue;

    const file = await readFileTool(cwd, { path }, options.signal);
    if (!file.ok) continue;
    const lines = file.content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      const haystack = options.caseSensitive ? line : line.toLowerCase();
      if (haystack.includes(needle)) {
        const match: SearchMatch = {
          path,
          line: index + 1,
          text: line
        };
        if (options.contextLines) {
          match.before = lines.slice(Math.max(0, index - options.contextLines), index);
          match.after = lines.slice(index + 1, index + 1 + options.contextLines);
        }
        matches.push(match);
        if (matches.length >= options.maxResults) return { ok: true, matches };
      }
    }
  }

  return { ok: true, matches };
}

function selectLineRange(
  content: string,
  startLine: unknown,
  endLine: unknown
): FileToolResult {
  if (startLine === undefined && endLine === undefined) return { ok: true, content };
  const start = positiveInteger(startLine, 1);
  const end = positiveInteger(endLine, Number.MAX_SAFE_INTEGER);
  if (end < start) return { ok: false, error: 'endLine must be greater than or equal to startLine.' };
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const selected = lines.slice(start - 1, end);
  const hasTrailingNewline = end < lines.length;
  return { ok: true, content: `${selected.join('\n')}${hasTrailingNewline ? '\n' : ''}` };
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

const globMatchers = new Map<string, (test: string) => boolean>();

function matchesGlob(path: string, glob: string): boolean {
  const pattern = glob.trim().replace(/\\/g, '/');
  let matcher = globMatchers.get(pattern);
  if (!matcher) {
    matcher = picomatch(pattern, { dot: true });
    globMatchers.set(pattern, matcher);
  }
  return matcher(path);
}

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}
