import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

export type FileToolResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

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

function resolveInsideProject(cwd: string, inputPath: string): FileToolResult {
  const root = resolve(cwd);
  const target = resolve(root, inputPath);
  const rel = relative(root, target);

  if (rel === '' || rel.startsWith('..') || resolve(target) === resolve(root, '..')) {
    return { ok: false, error: `Path is outside project: ${inputPath}` };
  }

  return { ok: true, content: target };
}

export async function readFileTool(
  cwd: string,
  args: { path?: unknown; startLine?: unknown; endLine?: unknown }
): Promise<FileToolResult> {
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

async function walk(cwd: string, dir = '.'): Promise<string[]> {
  const entries = await readdir(resolve(cwd, dir), { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const child = dir === '.' ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', 'dist', 'coverage', '.helix'].includes(entry.name)) continue;
      files.push(...await walk(cwd, child));
    } else if (entry.isFile()) {
      files.push(child);
    }
  }

  return files;
}

export async function listFilesTool(cwd: string): Promise<{ ok: true; files: string[] } | { ok: false; error: string }> {
  try {
    return { ok: true, files: (await walk(cwd)).sort() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function searchFilesTool(
  cwd: string,
  args: {
    query?: unknown;
    glob?: unknown;
    caseSensitive?: unknown;
    maxResults?: unknown;
    contextLines?: unknown;
  }
): Promise<SearchToolResult> {
  if (typeof args.query !== 'string' || !args.query.trim()) {
    return { ok: false, error: 'search_files requires a string query.' };
  }

  const listed = await listFilesTool(cwd);
  if (!listed.ok) return listed;

  const matches: SearchMatch[] = [];
  const caseSensitive = args.caseSensitive === true;
  const maxResults = positiveInteger(args.maxResults, 100);
  const contextLines = positiveInteger(args.contextLines, 0);
  const needle = caseSensitive ? args.query : args.query.toLowerCase();

  for (const path of listed.files) {
    if (typeof args.glob === 'string' && args.glob.trim() && !matchesGlob(path, args.glob)) continue;
    const file = await readFileTool(cwd, { path });
    if (!file.ok) continue;
    const lines = file.content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      const haystack = caseSensitive ? line : line.toLowerCase();
      if (haystack.includes(needle)) {
        const match: SearchMatch = {
          path,
          line: index + 1,
          text: line
        };
        if (contextLines) {
          match.before = lines.slice(Math.max(0, index - contextLines), index);
          match.after = lines.slice(index + 1, index + 1 + contextLines);
        }
        matches.push(match);
        if (matches.length >= maxResults) return { ok: true, matches };
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

function matchesGlob(path: string, glob: string): boolean {
  const pattern = glob.trim().replace(/\\/g, '/');
  if (pattern.startsWith('*.')) return path.endsWith(pattern.slice(1));
  if (pattern.endsWith('/*')) return path.startsWith(pattern.slice(0, -1));
  return path === pattern;
}

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}
