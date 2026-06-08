import { describe, expect, it } from 'vitest';
import { ContentStreamFormatter, stripMarkdown } from '../src/cli/terminal-format.js';

describe('stripMarkdown', () => {
  it('removes bold, headings, and horizontal rules', () => {
    const input = '## Title\n\n**2026年5月大模型排行榜** 汇总\n\n---\n\n正文';
    expect(stripMarkdown(input)).toBe('Title\n\n2026年5月大模型排行榜 汇总\n\n正文');
  });

  it('converts list markers to bullets', () => {
    expect(stripMarkdown('- item one\n* item two')).toBe('• item one\n• item two');
  });
});

describe('ContentStreamFormatter', () => {
  it('strips markdown when a full line is complete', () => {
    const fmt = new ContentStreamFormatter();
    const parts = [fmt.push('**bol'), fmt.push('d** text\n'), fmt.flush()];
    expect(parts.join('')).toBe('bold text\n');
  });
});
