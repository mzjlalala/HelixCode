import { describe, expect, it } from 'vitest';
import { extractPartialJsonStringField, toolStreamContentField } from '../src/cli/json-stream.js';
import { AgentStreamUI } from '../src/cli/stream-ui.js';

describe('json-stream', () => {
  it('extracts partial string field from incomplete JSON', () => {
    const partial = '{"path":"src/a.ts","content":"line1\\nline2';
    expect(extractPartialJsonStringField(partial, 'path')).toBe('src/a.ts');
    expect(extractPartialJsonStringField(partial, 'content')).toBe('line1\nline2');
  });

  it('maps tools to content fields', () => {
    expect(toolStreamContentField('write_file')).toBe('content');
    expect(toolStreamContentField('read_file')).toBeNull();
  });
});

describe('AgentStreamUI', () => {
  it('streams incremental tool code content', () => {
    const chunks: string[] = [];
    const ui = new AgentStreamUI((text) => chunks.push(text));

    ui.handleToolCallDelta({
      index: 0,
      name: 'write_file',
      argumentsDelta: '{"path":"a.ts","content":"hello',
      argumentsSoFar: '{"path":"a.ts","content":"hello'
    });
    ui.handleToolCallDelta({
      index: 0,
      name: 'write_file',
      argumentsDelta: ' world',
      argumentsSoFar: '{"path":"a.ts","content":"hello world'
    });

    expect(chunks.join('')).toContain('write file');
    expect(chunks.join('')).toContain('hello world');
    expect(ui.toolPreviewStreamed).toBe(true);
  });

  it('wraps markdown code fences with labels', () => {
    const chunks: string[] = [];
    const ui = new AgentStreamUI((text) => chunks.push(text));
    ui.handleContentToken('```ts\nconst x = 1;\n```');
    expect(chunks.join('')).toContain('ts');
    expect(chunks.join('')).toContain('const x = 1;');
  });

  it('inserts newline between reasoning and answer', () => {
    const chunks: string[] = [];
    const ui = new AgentStreamUI((text) => chunks.push(text));
    ui.handleReasoning('Thinking...');
    ui.handleContentToken('Answer here\n');
    const out = chunks.join('');
    expect(out).toContain('Thinking...');
    expect(out).toContain('\nAnswer here');
  });

  it('strips bold markdown in streamed answer', () => {
    const chunks: string[] = [];
    const ui = new AgentStreamUI((text) => chunks.push(text));
    ui.handleContentToken('**排行榜**\n');
    ui.flushContent();
    expect(chunks.join('')).toContain('排行榜');
    expect(chunks.join('')).not.toContain('**');
  });

  it('inserts newline between reasoning and tool activity', () => {
    const chunks: string[] = [];
    const ui = new AgentStreamUI((text) => chunks.push(text));
    ui.handleReasoning('Search now');
    ui.handleToolActivity({ phase: 'start', tool: 'web_search', summary: 'Execute web_search' });
    expect(chunks.join('')).toMatch(/Search now[\s\S]*Execute web_search/);
    expect(chunks.join('')).toContain('\n');
  });
});
