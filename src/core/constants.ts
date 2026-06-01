/** In-memory conversation history cap (also used when persisting to disk). */
export const DEFAULT_MAX_HISTORY_MESSAGES = 80;

/** Default message count kept after /compact. */
export const DEFAULT_COMPACT_KEEP_MESSAGES = 20;

/** Max tool execution rounds per agent run() call. */
export const DEFAULT_MAX_TOOL_ROUNDS = 6;

/** Skip search/read for files larger than this (bytes). */
export const MAX_SEARCH_FILE_BYTES = 512 * 1024;

/** Default max matches returned by search_files. */
export const DEFAULT_SEARCH_MAX_RESULTS = 100;

/** web_search: default and max result count. */
export const WEB_SEARCH_DEFAULT_COUNT = 8;
export const WEB_SEARCH_MAX_COUNT = 15;

/** Directories skipped during file walk / search. */
export const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.helix',
  'build',
  '.next',
  'target',
  'vendor',
  '__pycache__',
  '.venv',
  '.turbo',
  '.cache',
  'out'
]);

/** Extensions treated as binary (skipped during text search). */
export const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.svg',
  '.pdf', '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.wasm', '.exe', '.dll', '.so', '.dylib', '.bin',
  '.mp3', '.mp4', '.avi', '.mov', '.mkv',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.class', '.jar', '.pyc', '.o', '.a'
]);
