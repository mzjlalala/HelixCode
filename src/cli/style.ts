// Terminal styling utilities using ANSI escape codes

const IS_TTY = process.stdout.isTTY;

function ansi(code: number, text: string): string {
  return IS_TTY ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export const style = {
  bold: (t: string) => ansi(1, t),
  dim: (t: string) => ansi(2, t),
  italic: (t: string) => ansi(3, t),

  // Colors
  cyan: (t: string) => ansi(36, t),
  green: (t: string) => ansi(32, t),
  yellow: (t: string) => ansi(33, t),
  red: (t: string) => ansi(31, t),
  blue: (t: string) => ansi(34, t),
  magenta: (t: string) => ansi(35, t),

  // Named semantic styles
  prompt: (t: string) => ansi(36, t),       // cyan
  success: (t: string) => ansi(32, t),      // green
  warning: (t: string) => ansi(33, t),      // yellow
  error: (t: string) => ansi(31, t),        // red
  info: (t: string) => ansi(2, t),          // dim
  highlight: (t: string) => ansi(1, t),     // bold
  label: (t: string) => ansi(35, t),        // magenta for labels
};

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

export function divider(): string {
  const width = Math.min(process.stdout.columns ?? 80, 80);
  return style.dim(SYMBOL.divider.repeat(width));
}

const LOGO = [
  '        ╭─╮       ╭─╮',
  '       ╱   ╲     ╱   ╲',
  '      ╱     ╲   ╱     ╲',
  '      ╲     ╱   ╲     ╱',
  '       ╲   ╱     ╲   ╱',
  '        ╰─╯       ╰─╯',
  '',
  '      H E L I X C O D E',
  '  AI Software Engineering Agent',
];

export function showWelcome(cwd: string, modelName: string, commands: string): void {
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
