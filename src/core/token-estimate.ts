/**
 * Token / Context 用量估算
 *
 * 不依赖 tiktoken，用字符启发式估算（中英混排、代码文本）。
 * 用于 /status、诊断与 read_file 大文件提示，数值为近似值。
 */

import type { ChatMessage } from '../llm/types.js';
import type { TokenUsage } from '../llm/usage.js';
/** 单段文本的 token 估算明细 */
export interface TextTokenEstimate {
  chars: number;
  tokens: number;
}

/** 整段对话上下文的用量汇总 */
export interface ContextUsage {
  /** 系统提示（含项目指令）估算 token */
  systemTokens: number;
  /** 历史消息（不含 system）估算 token */
  historyTokens: number;
  /** 合计 */
  totalTokens: number;
  /** 参考上限（模型 context window） */
  limitTokens: number;
  /** 历史消息条数 */
  messageCount: number;
  /** 用量百分比 0–100（优先基于 API prompt_tokens，否则为估算） */
  percent: number;
  /** 最近一次 API 返回且与当前 history 同步的 usage */
  lastRequest?: TokenUsage;
  /** history 自上次 API 调用后已变化，API 数字可能滞后 */
  apiStale?: boolean;
}

const CJK_CHAR =
  /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff]/;

/**
 * 估算单段文本的 token 数
 * - CJK 等宽字符：约 1.5 字符 / token
 * - 拉丁字母、数字、符号：约 4 字符 / token
 */
export function estimateTextTokens(text: string): TextTokenEstimate {
  if (!text) return { chars: 0, tokens: 0 };

  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (CJK_CHAR.test(ch)) cjk += 1;
    else other += 1;
  }

  const tokens = Math.max(1, Math.ceil(cjk / 1.5 + other / 4));
  return { chars: text.length, tokens };
}

/** 估算单条 ChatMessage（含 tool_calls、reasoning） */
export function estimateMessageTokens(message: ChatMessage): number {
  let total = 4; // role / 结构开销

  if (message.content) {
    total += estimateTextTokens(message.content).tokens;
  }
  if (message.reasoning_content) {
    total += estimateTextTokens(message.reasoning_content).tokens;
  }
  if (message.tool_calls?.length) {
    for (const call of message.tool_calls) {
      total += estimateTextTokens(call.name).tokens;
      total += estimateTextTokens(JSON.stringify(call.arguments)).tokens;
    }
  }

  return total;
}

/** 估算消息列表总 token */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

/**
 * 汇总 Agent 即将发送给模型的上下文用量
 * @param systemPrompt 完整 system 消息正文
 * @param history 内存中的历史（不含 system）
 * @param limitTokens context window 参考上限
 */
export function estimateContextUsage(
  systemPrompt: string,
  history: ChatMessage[],
  limitTokens: number
): ContextUsage {
  const systemTokens = estimateTextTokens(systemPrompt).tokens;
  const historyTokens = estimateMessagesTokens(history);
  const totalTokens = systemTokens + historyTokens;
  const safeLimit = Math.max(1, limitTokens);
  const percent = Math.min(100, Math.round((totalTokens / safeLimit) * 100));

  return {
    systemTokens,
    historyTokens,
    totalTokens,
    limitTokens: safeLimit,
    messageCount: history.length,
    percent
  };
}

/**
 * 合并 API usage 与本地估算（DeepSeek 文档：以 response.usage 为准）
 * @param lastRequest 最近一次 LLM 调用的 usage；仅在与 history 同步时作为主展示
 */
export function buildContextUsage(
  systemPrompt: string,
  history: ChatMessage[],
  limitTokens: number,
  lastRequest?: TokenUsage | null,
  apiStale = false
): ContextUsage {
  const estimated = estimateContextUsage(systemPrompt, history, limitTokens);

  if (!lastRequest || apiStale) {
    const out: ContextUsage = { ...estimated };
    if (lastRequest) {
      out.lastRequest = lastRequest;
      out.apiStale = apiStale;
    }
    return out;
  }

  const safeLimit = estimated.limitTokens;
  const apiPercent = Math.min(100, Math.round((lastRequest.prompt_tokens / safeLimit) * 100));

  return {
    ...estimated,
    totalTokens: lastRequest.prompt_tokens,
    percent: apiPercent,
    lastRequest,
    apiStale: false
  };
}

/** 格式化为 /status 输出的一行或多行文本 */
export function formatContextUsageLines(usage: ContextUsage): string[] {
  const lines: string[] = [];

  if (usage.lastRequest && !usage.apiStale) {
    const u = usage.lastRequest;
    lines.push(
      `context (API): ${formatTokenCount(u.prompt_tokens)} prompt / ${formatTokenCount(usage.limitTokens)} (${usage.percent}%)`
    );
    lines.push(
      `  completion: ${formatTokenCount(u.completion_tokens)} | total: ${formatTokenCount(u.total_tokens)}`
    );
    if (u.prompt_cache_hit_tokens !== undefined || u.prompt_cache_miss_tokens !== undefined) {
      lines.push(
        `  cache: hit ${formatTokenCount(u.prompt_cache_hit_tokens ?? 0)} | miss ${formatTokenCount(u.prompt_cache_miss_tokens ?? 0)}`
      );
    }
    const reasoning = u.completion_tokens_details?.reasoning_tokens;
    if (reasoning !== undefined && reasoning > 0) {
      lines.push(`  reasoning tokens: ${formatTokenCount(reasoning)}`);
    }
  }

  if (!usage.lastRequest || usage.apiStale) {
    lines.push(
      `context (est.): ~${formatTokenCount(usage.totalTokens)} / ${formatTokenCount(usage.limitTokens)} tokens (${usage.percent}%)`
    );
    lines.push(
      `  system: ~${formatTokenCount(usage.systemTokens)} | history (${usage.messageCount} msgs): ~${formatTokenCount(usage.historyTokens)}`
    );
    if (usage.apiStale && usage.lastRequest) {
      lines.push(
        `  last API prompt: ${formatTokenCount(usage.lastRequest.prompt_tokens)} (history changed since last request)`
      );
    }
  }

  if (usage.percent >= 90) {
    lines.push('  warning: context nearly full — run /compact or /reset');
  } else if (usage.percent >= 75) {
    lines.push('  note: context usage high — consider /compact');
  }

  return lines;
}

function formatTokenCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
