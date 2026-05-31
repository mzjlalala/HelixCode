import { describe, expect, it } from 'vitest';
import {
  cycleMode, shouldAutoApprove, shouldSkip, formatModeTag, MODE_LABELS
} from '../src/cli/permission-mode.js';
import type { PermissionMode } from '../src/cli/permission-mode.js';

describe('permission-mode', () => {
  describe('cycleMode', () => {
    it('cycles through modes in order', () => {
      expect(cycleMode('default')).toBe('acceptEdits');
      expect(cycleMode('acceptEdits')).toBe('plan');
      expect(cycleMode('plan')).toBe('auto');
      expect(cycleMode('auto')).toBe('default');
    });
  });

  describe('shouldAutoApprove', () => {
    const editTools = ['write_file', 'replace_in_file', 'edit_file', 'apply_patch'];
    const shellTools = ['run_shell'];
    const otherTools = ['read_file', 'list_files', 'git_status'];

    it('default never auto-approves', () => {
      for (const tool of [...editTools, ...shellTools, ...otherTools]) {
        expect(shouldAutoApprove(tool, 'default')).toBe(false);
      }
    });

    it('acceptEdits auto-approves file edits but not shell', () => {
      for (const tool of editTools) {
        expect(shouldAutoApprove(tool, 'acceptEdits')).toBe(true);
      }
      for (const tool of shellTools) {
        expect(shouldAutoApprove(tool, 'acceptEdits')).toBe(false);
      }
    });

    it('plan never auto-approves', () => {
      for (const tool of [...editTools, ...shellTools]) {
        expect(shouldAutoApprove(tool, 'plan')).toBe(false);
      }
    });

    it('auto approves everything', () => {
      for (const tool of [...editTools, ...shellTools, ...otherTools]) {
        expect(shouldAutoApprove(tool, 'auto')).toBe(true);
      }
    });
  });

  describe('shouldSkip', () => {
    it('skips everything in plan mode', () => {
      expect(shouldSkip('write_file', 'plan')).toBe(true);
      expect(shouldSkip('run_shell', 'plan')).toBe(true);
    });

    it('never skips in other modes', () => {
      for (const mode of ['default', 'acceptEdits', 'auto'] as PermissionMode[]) {
        expect(shouldSkip('write_file', mode)).toBe(false);
        expect(shouldSkip('run_shell', mode)).toBe(false);
      }
    });
  });

  describe('formatModeTag', () => {
    it('formats tag with the mode label and resets color', () => {
      expect(formatModeTag('default', '\x1b[0m')).toContain('default');
      expect(formatModeTag('default', '\x1b[0m')).toContain('\x1b[0m');
      expect(formatModeTag('default', '\x1b[0m')).toContain('\x1b[36m'); // cyan
    });

    it('uses correct colors per mode', () => {
      expect(formatModeTag('default', 'R')).toContain('\x1b[36m'); // cyan
      expect(formatModeTag('acceptEdits', 'R')).toContain('\x1b[33m'); // yellow
      expect(formatModeTag('plan', 'R')).toContain('\x1b[35m'); // magenta
      expect(formatModeTag('auto', 'R')).toContain('\x1b[31m'); // red
    });
  });

  describe('MODE_LABELS', () => {
    it('has all four modes defined', () => {
      expect(MODE_LABELS.default.label).toBe('default');
      expect(MODE_LABELS.acceptEdits.label).toBe('edit');
      expect(MODE_LABELS.plan.label).toBe('plan');
      expect(MODE_LABELS.auto.label).toBe('auto');
    });
  });
});
