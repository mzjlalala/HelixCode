export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto';

const MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto'];

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

export function cycleMode(current: PermissionMode): PermissionMode {
  const idx = MODES.indexOf(current);
  return MODES[(idx + 1) % MODES.length] ?? 'default';
}

const EDIT_TOOLS = new Set(['write_file', 'replace_in_file', 'edit_file', 'apply_patch']);

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

export function shouldSkip(_tool: string, mode: PermissionMode): boolean {
  return mode === 'plan';
}

const MODE_ANSI: Record<PermissionMode, string> = {
  default: '\x1b[36m',    // cyan
  acceptEdits: '\x1b[33m', // yellow
  plan: '\x1b[35m',        // magenta
  auto: '\x1b[31m',        // red
};

/** Returns the mode label with ANSI color, then restores fgReset */
export function formatModeTag(mode: PermissionMode, fgReset: string): string {
  return `${MODE_ANSI[mode]}${MODE_LABELS[mode].label}${fgReset}`;
}
