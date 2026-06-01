/**
 * 任务计划持久化
 * Agent 通过 update_plan 工具维护的多步骤计划，写入 .helix/plan.json
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { PlanItem } from '../agent/terminal-agent.js';

const PLAN_FILE = '.helix/plan.json';

export interface SavedPlan {
  version: 1;
  savedAt: string;
  items: PlanItem[];
}

/** 启动时恢复计划；无效数据返回空数组 */
export async function loadPlan(cwd: string): Promise<PlanItem[]> {
  try {
    const content = await readFile(resolve(cwd, PLAN_FILE), 'utf8');
    const parsed = JSON.parse(content) as SavedPlan;
    if (parsed.version === 1 && Array.isArray(parsed.items)) {
      return parsed.items.filter(isPlanItem);
    }
    return [];
  } catch {
    return [];
  }
}

/** 计划变更后写入磁盘 */
export async function savePlan(cwd: string, items: PlanItem[]): Promise<void> {
  const target = resolve(cwd, PLAN_FILE);
  await mkdir(dirname(target), { recursive: true });
  const payload: SavedPlan = {
    version: 1,
    savedAt: new Date().toISOString(),
    items
  };
  await writeFile(target, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function isPlanItem(value: unknown): value is PlanItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as { step?: unknown; status?: unknown };
  return typeof item.step === 'string'
    && item.step.trim().length > 0
    && (item.status === 'pending' || item.status === 'in_progress' || item.status === 'completed');
}
