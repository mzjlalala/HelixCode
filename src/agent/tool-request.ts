export interface ToolRequest {
  tool: string;
  args: Record<string, unknown>;
}

export function parseToolRequest(text: string): ToolRequest | null {
  for (const candidate of candidateJsonObjects(text)) {
    const request = parseCandidate(candidate);
    if (request) return request;
  }
  return null;
}

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

function candidateJsonObjects(text: string): string[] {
  const candidates = [text.trim()];
  for (const fenced of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const content = fenced[1];
    if (content) candidates.push(content.trim());
  }

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '{') continue;
    const object = extractBalancedObject(text, index);
    if (object) candidates.push(object);
  }

  return [...new Set(candidates.filter(Boolean))];
}

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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
