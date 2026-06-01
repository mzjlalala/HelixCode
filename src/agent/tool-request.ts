/**
 * 遗留 JSON 工具协议解析
 *
 * 在不支持原生 function calling 的模型上，LLM 可能在文本中嵌入
 * `{"tool":"...", "args":{...}}` 或 fenced code block。本模块从回复中提取并解析这些候选 JSON。
 */

/** 解析成功的工具请求结构。 */
export interface ToolRequest {
  tool: string;
  args: Record<string, unknown>;
}

/**
 * 从 LLM 文本回复中解析工具请求。
 * 依次尝试多种候选 JSON 片段，首个合法 `{ tool, args }` 即返回。
 */
export function parseToolRequest(text: string): ToolRequest | null {
  for (const candidate of candidateJsonObjects(text)) {
    const request = parseCandidate(candidate);
    if (request) return request;
  }
  return null;
}

/** 尝试 JSON.parse 并校验 tool 字段为字符串。 */
function parseCandidate(candidate: string): ToolRequest | null {
  try {
    const parsed = JSON.parse(candidate) as { tool?: unknown; args?: unknown };
    if (typeof parsed.tool !== 'string') return null;
    return {
      tool: parsed.tool,
      args: isPlainRecord(parsed.args) ? parsed.args : {}
    };
  } catch {
    return null;
  }
}

/**
 * 从文本中收集所有可能的 JSON 候选：
 * 1. 全文 trim
 * 2. markdown ```json``` 代码块内容
 * 3. 文本中每个平衡的 `{...}` 对象
 */
function candidateJsonObjects(text: string): string[] {
  const candidates = [text.trim()];
  for (const fenced of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const content = fenced[1];
    if (content) candidates.push(content.trim());
  }

  // 扫描每个 `{` 起点，提取括号平衡且忽略字符串内括号的 JSON 对象
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '{') continue;
    const object = extractBalancedObject(text, index);
    if (object) candidates.push(object);
  }

  return [...new Set(candidates.filter(Boolean))];
}

/**
 * 从 start 位置的 `{` 起，提取第一个括号平衡的 JSON 对象字符串。
 * 正确处理字符串内的转义与嵌套括号。
 */
function extractBalancedObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

/** 判断 value 是否为普通对象（非 null、非数组）。 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
