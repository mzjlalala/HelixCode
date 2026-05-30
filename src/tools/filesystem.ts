import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

export type FileToolResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
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
  args: { path?: unknown }
): Promise<FileToolResult> {
  if (typeof args.path !== 'string' || !args.path.trim()) {
    return { ok: false, error: 'read_file requires a string path.' };
  }

  const resolved = resolveInsideProject(cwd, args.path);
  if (!resolved.ok) return resolved;

  try {
    return { ok: true, content: await readFile(resolved.content, 'utf8') };
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
  args: { query?: unknown }
): Promise<SearchToolResult> {
  if (typeof args.query !== 'string' || !args.query.trim()) {
    return { ok: false, error: 'search_files requires a string query.' };
  }

  const listed = await listFilesTool(cwd);
  if (!listed.ok) return listed;

  const matches: SearchMatch[] = [];
  const needle = args.query.toLowerCase();

  for (const path of listed.files) {
    const file = await readFileTool(cwd, { path });
    if (!file.ok) continue;
    file.content.split(/\r?\n/).forEach((line, index) => {
      if (line.toLowerCase().includes(needle)) {
        matches.push({ path, line: index + 1, text: line });
      }
    });
  }

  return { ok: true, matches };
}
