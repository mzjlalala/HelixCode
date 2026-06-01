/**
 * 全局常量
 * 集中管理会话、搜索、Web 等模块的默认阈值，避免魔法数字散落各处
 */

/** 内存对话历史上限（持久化到磁盘时使用同一上限） */
export const DEFAULT_MAX_HISTORY_MESSAGES = 80;

/** /compact 命令默认保留的消息条数 */
export const DEFAULT_COMPACT_KEEP_MESSAGES = 20;

/** 单次 agent.run() 允许的最大工具调用轮次 */
export const DEFAULT_MAX_TOOL_ROUNDS = 6;

/** 超过此大小的文件在 search_files 中跳过（字节） */
export const MAX_SEARCH_FILE_BYTES = 512 * 1024;

/** search_files 默认最大匹配条数 */
export const DEFAULT_SEARCH_MAX_RESULTS = 100;

/** web_search 默认与最大返回条数 */
export const WEB_SEARCH_DEFAULT_COUNT = 8;
export const WEB_SEARCH_MAX_COUNT = 15;

/** 遍历/搜索时跳过的目录名 */
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

/** 视为二进制、不参与文本搜索的扩展名 */
export const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.svg',
  '.pdf', '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.wasm', '.exe', '.dll', '.so', '.dylib', '.bin',
  '.mp3', '.mp4', '.avi', '.mov', '.mkv',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.class', '.jar', '.pyc', '.o', '.a'
]);
