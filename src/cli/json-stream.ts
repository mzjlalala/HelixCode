/**
 * 从流式累积的不完整 JSON 中提取字符串字段（用于 write_file 等 tool 参数预览）
 */

/** 从不完整的 JSON 文本中提取指定 string 字段已接收到的内容 */
export function extractPartialJsonStringField(partialJson: string, field: string): string {
  const key = `"${field}"`;
  const keyIdx = partialJson.indexOf(key);
  if (keyIdx === -1) return '';

  let i = keyIdx + key.length;
  while (i < partialJson.length && /\s/.test(partialJson[i]!)) i += 1;
  if (partialJson[i] !== ':') return '';
  i += 1;
  while (i < partialJson.length && /\s/.test(partialJson[i]!)) i += 1;
  if (partialJson[i] !== '"') return '';
  i += 1;

  let result = '';
  while (i < partialJson.length) {
    const ch = partialJson[i]!;
    if (ch === '\\') {
      if (i + 1 >= partialJson.length) break;
      const esc = partialJson[i + 1]!;
      switch (esc) {
        case 'n': result += '\n'; break;
        case 't': result += '\t'; break;
        case 'r': result += '\r'; break;
        case '"': result += '"'; break;
        case '\\': result += '\\'; break;
        case '/': result += '/'; break;
        case 'b': result += '\b'; break;
        case 'f': result += '\f'; break;
        case 'u': {
          if (i + 5 < partialJson.length) {
            const hex = partialJson.slice(i + 2, i + 6);
            if (/^[0-9a-fA-F]{4}$/.test(hex)) {
              result += String.fromCharCode(parseInt(hex, 16));
              i += 6;
              continue;
            }
          }
          result += esc;
          break;
        }
        default: result += esc;
      }
      i += 2;
      continue;
    }
    if (ch === '"') break;
    result += ch;
    i += 1;
  }

  return result;
}

/** 需流式展示正文的 tool 及其 JSON 字段名 */
export function toolStreamContentField(toolName: string): string | null {
  switch (toolName) {
    case 'write_file':
    case 'edit_file':
      return 'content';
    case 'replace_in_file':
      return 'newText';
    case 'apply_patch':
      return 'patch';
    default:
      return null;
  }
}
