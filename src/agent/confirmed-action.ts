/**
 * 确认 UI 与工具注册表的桥接层
 *
 * 预览与执行需确认的工具时，委托给 Agent 共享的 ToolRegistry，
 * 确保 UI 展示与 Agent 实际调用的工具定义、实现完全一致。
 */
import type { AgentTurnResult } from './terminal-agent.js';
import type { ToolRegistry, ConfirmedToolResult } from '../tools/registry.js';

type Confirmation = Extract<AgentTurnResult, { type: 'confirmation' }>;

/**
 * 为确认 UI 生成工具操作预览文本。
 * 使用 Agent 的 tool registry，保证预览与 Agent 调用的工具一致。
 */
export async function previewConfirmedTool(
  cwd: string,
  confirmation: Confirmation,
  registry: ToolRegistry
): Promise<string> {
  return registry.preview(confirmation.tool, cwd, confirmation.args);
}

/**
 * 用户批准后执行需确认的工具。
 * 使用 Agent 的 tool registry，保证执行路径与 Agent 调用一致。
 */
export async function executeConfirmedTool(
  cwd: string,
  confirmation: Confirmation,
  registry: ToolRegistry
): Promise<ConfirmedToolResult> {
  return registry.executeConfirmed(confirmation.tool, cwd, confirmation.args);
}
