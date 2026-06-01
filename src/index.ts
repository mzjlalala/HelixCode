/**
 * HelixCode 库入口
 * 供外部项目以 npm 包形式引入 Agent 与配置 API
 */
export { TerminalAgent } from './agent/terminal-agent.js';
export { loadConfig, loadFileConfig, loadProjectInstructions, saveFileConfig } from './core/config.js';
export { cycleMode, shouldAutoApprove, shouldSkip, formatModeTag, MODE_LABELS } from './cli/permission-mode.js';
export type { PermissionMode } from './cli/permission-mode.js';
