/**
 * 权限模式模块
 *
 * 定义 REPL 中的四种工具执行权限策略（default / acceptEdits / plan / auto），
 * 提供模式循环切换、自动批准/跳过判定，以及带 ANSI 颜色的模式标签格式化。
 */

/** 权限模式：default 逐项确认；acceptEdits 自动接受文件编辑；plan 只读；auto 全自动 */
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto';

/** Shift+Tab 循环切换时的顺序 */
const MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto'];

/** 模式的显示标签与简短说明（用于提示符与 /mode 输出） */
export interface ModeInfo {
  label: string;
  desc: string;
}

export const MODE_LABELS: Record<PermissionMode, ModeInfo> = {
  default: { label: 'default', desc: 'Prompt for every action' },
  acceptEdits: { label: 'edit', desc: 'Auto-accept file edits, prompt for shell' },
  plan: { label: 'plan', desc: 'Read-only: no modifications allowed' },
  auto: { label: 'auto', desc: 'Auto-accept all actions' },
};

/**
 * 切换到下一个权限模式（循环）
 * @param current 当前模式
 */
export function cycleMode(current: PermissionMode): PermissionMode {
  const idx = MODES.indexOf(current);
  return MODES[(idx + 1) % MODES.length] ?? 'default';
}

/** 视为「文件编辑类」的工具名集合（acceptEdits 模式下自动批准） */
const EDIT_TOOLS = new Set(['write_file', 'replace_in_file', 'edit_file', 'apply_patch']);

/**
 * 判断当前模式下是否应自动批准工具执行（无需用户确认）
 * @param tool 工具名称
 * @param mode 当前权限模式
 */
export function shouldAutoApprove(tool: string, mode: PermissionMode): boolean {
  switch (mode) {
    case 'auto':
      return true;
    case 'acceptEdits':
      return EDIT_TOOLS.has(tool);
    default:
      return false;
  }
}

/**
 * 判断当前模式下是否应跳过工具（plan 模式：禁止一切修改类操作）
 * @param _tool 工具名称（plan 模式下与具体工具无关，一律跳过）
 * @param mode 当前权限模式
 */
export function shouldSkip(_tool: string, mode: PermissionMode): boolean {
  return mode === 'plan';
}

/** 各模式在提示符中使用的 ANSI 前景色 */
export const MODE_ANSI: Record<PermissionMode, string> = {
  default: '\x1b[36m',    // 青色
  acceptEdits: '\x1b[33m', // 黄色
  plan: '\x1b[35m',        // 品红
  auto: '\x1b[31m',        // 红色
};

/**
 * 返回带 ANSI 颜色的模式标签，并在末尾恢复前景色
 * @param mode 权限模式
 * @param fgReset 恢复用的 ANSI 序列（与 REPL 反色提示符配合）
 */
export function formatModeTag(mode: PermissionMode, fgReset: string): string {
  return `${MODE_ANSI[mode]}${MODE_LABELS[mode].label}${fgReset}`;
}
