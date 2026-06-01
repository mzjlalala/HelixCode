/**
 * 终端样式工具模块
 *
 * 基于 ANSI 转义序列为 CLI 输出提供颜色、字重等样式，
 * 并包含欢迎界面、分隔线与符号常量。
 * 非 TTY 环境下自动降级为纯文本（不注入转义码）。
 */

const IS_TTY = process.stdout.isTTY;

/** 在非 TTY 时原样返回文本，否则包裹 ANSI 样式码 */
function ansi(code: number, text: string): string {
  return IS_TTY ? `\x1b[${code}m${text}\x1b[0m` : text;
}

/** 语义化终端样式：颜色、字重及 success/error 等命名风格 */
export const style = {
  bold: (t: string) => ansi(1, t),
  dim: (t: string) => ansi(2, t),
  italic: (t: string) => ansi(3, t),

  // 前景色
  cyan: (t: string) => ansi(36, t),
  green: (t: string) => ansi(32, t),
  yellow: (t: string) => ansi(33, t),
  red: (t: string) => ansi(31, t),
  blue: (t: string) => ansi(34, t),
  magenta: (t: string) => ansi(35, t),

  // 语义化别名（与业务含义对应）
  prompt: (t: string) => ansi(36, t),       // 青色 — 提示符
  success: (t: string) => ansi(32, t),      // 绿色 — 成功
  warning: (t: string) => ansi(33, t),      // 黄色 — 警告
  error: (t: string) => ansi(31, t),        // 红色 — 错误
  info: (t: string) => ansi(2, t),          // 暗淡 — 次要信息
  highlight: (t: string) => ansi(1, t),     // 粗体 — 强调
  label: (t: string) => ansi(35, t),        // 品红 — 标签
};

/** REPL 与状态输出中使用的 Unicode 符号 */
export const SYMBOL = {
  prompt: '✦',
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
  arrow: '→',
  bullet: '•',
  divider: '─',
};

/**
 * 生成分隔线（宽度不超过终端列数与 80 的较小值）
 */
export function divider(): string {
  const width = Math.min(process.stdout.columns ?? 80, 80);
  return style.dim(SYMBOL.divider.repeat(width));
}

/** ASCII 艺术 Logo 行（启动欢迎屏使用） */
const LOGO = [
  '          ╱╲     ╱╲',
  '         ╱  ╲   ╱  ╲',
  '        ╱    ╲ ╱    ╲',
  '        ╲    ╱ ╲    ╱',
  '         ╲  ╱   ╲  ╱',
  '          ╲╱     ╲╱',
  '',
  '      H E L I X C O D E',
  '  AI Software Engineering Agent',
];

/**
 * 显示 REPL 启动欢迎界面
 * @param cwd 当前工作目录
 * @param modelName 模型名称（可选，有则显示）
 * @param commands 可用斜杠命令摘要字符串
 */
export function showWelcome(cwd: string, modelName: string, commands: string): void {
  // 管道/重定向等非交互场景：简化为纯文本
  if (!IS_TTY) {
    process.stdout.write('HelixCode - terminal coding agent\n');
    process.stdout.write(`${cwd}\n\n`);
    return;
  }

  const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

  for (const line of LOGO) {
    process.stdout.write(`${cyan(line)}\n`);
  }
  process.stdout.write(`\n ${dim(cwd)}\n`);
  process.stdout.write(` ${dim(commands)}\n`);
  if (modelName) {
    process.stdout.write(` ${dim(`model: ${modelName}`)}\n`);
  }
  process.stdout.write('\n');
}
