import type { AgentTurnResult } from './terminal-agent.js';
import type { ToolRegistry, ConfirmedToolResult } from '../tools/registry.js';

type Confirmation = Extract<AgentTurnResult, { type: 'confirmation' }>;

/**
 * Generate a preview string for the confirmation UI.
 * Uses the agent's tool registry so preview matches the tools the agent invoked.
 */
export async function previewConfirmedTool(
  cwd: string,
  confirmation: Confirmation,
  registry: ToolRegistry
): Promise<string> {
  return registry.preview(confirmation.tool, cwd, confirmation.args);
}

/**
 * Execute a confirmed tool (after user approval).
 * Uses the agent's tool registry so execution matches the tools the agent invoked.
 */
export async function executeConfirmedTool(
  cwd: string,
  confirmation: Confirmation,
  registry: ToolRegistry
): Promise<ConfirmedToolResult> {
  return registry.executeConfirmed(confirmation.tool, cwd, confirmation.args);
}
