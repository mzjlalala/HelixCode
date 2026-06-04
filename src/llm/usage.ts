/**
 * LLM Token 用量（OpenAI 兼容 / DeepSeek API）
 *
 * 字段对齐 https://api-docs.deepseek.com/api/create-chat-completion
 * - prompt_tokens = prompt_cache_hit_tokens + prompt_cache_miss_tokens
 * - 流式需在请求中设置 stream_options.include_usage，末 chunk 携带 usage
 */

/** 单次 chat/completions 请求的 token 统计 */
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** DeepSeek：命中上下文缓存的 prompt token */
  prompt_cache_hit_tokens?: number;
  /** DeepSeek：未命中缓存的 prompt token */
  prompt_cache_miss_tokens?: number;
  completion_tokens_details?: {
    /** DeepSeek 思考模式：推理 token */
    reasoning_tokens?: number;
  };
}

/** 从 API JSON 的 usage 字段解析；无效时返回 undefined */
export function parseTokenUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const u = raw as Record<string, unknown>;
  const prompt = u.prompt_tokens;
  const completion = u.completion_tokens;
  if (typeof prompt !== 'number' || typeof completion !== 'number') return undefined;

  const total = typeof u.total_tokens === 'number' ? u.total_tokens : prompt + completion;

  const details = u.completion_tokens_details;
  let completion_tokens_details: TokenUsage['completion_tokens_details'];
  if (details && typeof details === 'object') {
    const d = details as Record<string, unknown>;
    if (typeof d.reasoning_tokens === 'number') {
      completion_tokens_details = { reasoning_tokens: d.reasoning_tokens };
    }
  }

  const usage: TokenUsage = {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total
  };

  if (typeof u.prompt_cache_hit_tokens === 'number') {
    usage.prompt_cache_hit_tokens = u.prompt_cache_hit_tokens;
  }
  if (typeof u.prompt_cache_miss_tokens === 'number') {
    usage.prompt_cache_miss_tokens = u.prompt_cache_miss_tokens;
  }
  if (completion_tokens_details) {
    usage.completion_tokens_details = completion_tokens_details;
  }

  return usage;
}
