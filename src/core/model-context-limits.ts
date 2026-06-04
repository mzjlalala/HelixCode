/**
 * 按模型名解析 context window 上限
 *
 * 仅从 .helix/config.json 读取，不在代码中写死各模型数值：
 * 1. modelContextLimits[当前模型]
 * 2. contextTokenLimit（全局 fallback）
 * 3. provider 默认（deepseek 64k / 其它 128k，仅作未配置时的兜底）
 */

import type { HelixFileConfig, LlmProvider } from './config.js';
import { DEFAULT_CONTEXT_TOKEN_LIMIT } from './constants.js';

type ContextLimitFile = Pick<HelixFileConfig, 'contextTokenLimit' | 'modelContextLimits'>;

/** 在 modelContextLimits 中按模型名（忽略大小写）查找 token 上限 */
export function lookupModelContextLimit(
  model: string,
  limits: Record<string, number> | undefined
): number | undefined {
  if (!limits || !model.trim()) return undefined;

  const normalized = model.trim().toLowerCase();
  for (const [key, value] of Object.entries(limits)) {
    if (key.trim().toLowerCase() === normalized && Number.isInteger(value) && value > 0) {
      return value;
    }
  }
  return undefined;
}

/**
 * 解析当前模型应用的 context token 上限
 * @param model 当前 chat 模型名（含 /model 切换后的值）
 */
export function resolveContextTokenLimit(
  model: string,
  file: ContextLimitFile = {},
  provider: LlmProvider = 'openai'
): number {
  const fromModelMap = lookupModelContextLimit(model, file.modelContextLimits);
  if (fromModelMap !== undefined) return fromModelMap;

  if (typeof file.contextTokenLimit === 'number'
    && Number.isInteger(file.contextTokenLimit)
    && file.contextTokenLimit > 0) {
    return file.contextTokenLimit;
  }

  return provider === 'deepseek' ? 64_000 : DEFAULT_CONTEXT_TOKEN_LIMIT;
}
