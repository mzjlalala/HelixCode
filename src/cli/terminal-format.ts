/**
 * 终端纯文本格式化：剥离 Markdown，适配流式与非流式输出。
 */

/** 将 Markdown 转为适合终端显示的纯文本 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[-*]\s+/gm, '• ')
    .replace(/^\|[\s:-]+\|[\s:-]+\|$/gm, '')
    .replace(/^\|(.+)\|$/gm, (_, s) => s.split('|').map((c: string) => c.trim()).join('  '))
    .replace(/^>{1,3}\s+/gm, '')
    .replace(/^[-*_]{3,}$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '');
}

/** 流式正文：按行剥离 Markdown，避免 ** 等标记在 chunk 边界被截断 */
export class ContentStreamFormatter {
  private lineBuffer = '';

  push(chunk: string): string {
    if (!chunk) return '';
    this.lineBuffer += chunk;

    let out = '';
    while (true) {
      const nl = this.lineBuffer.indexOf('\n');
      if (nl === -1) break;
      const line = this.lineBuffer.slice(0, nl + 1);
      this.lineBuffer = this.lineBuffer.slice(nl + 1);
      out += stripMarkdown(line);
    }
    return out;
  }

  flush(): string {
    if (!this.lineBuffer) return '';
    const out = stripMarkdown(this.lineBuffer);
    this.lineBuffer = '';
    return out;
  }

  reset(): void {
    this.lineBuffer = '';
  }
}
