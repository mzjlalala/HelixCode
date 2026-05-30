import { describe, expect, it } from 'vitest';
import { parseToolRequest } from '../src/agent/tool-request.js';

describe('parseToolRequest', () => {
  it('parses strict tool JSON', () => {
    expect(parseToolRequest('{"tool":"read_file","args":{"path":"README.md"}}')).toEqual({
      tool: 'read_file',
      args: { path: 'README.md' }
    });
  });

  it('parses tool JSON inside code fences or prose', () => {
    const fenced = ['```json', '{"tool":"git_status","args":{}}', '```'].join('\n');
    const prose = [
      'I need to inspect the repository first.',
      '{"tool":"search_files","args":{"query":"HelixCode"}}',
      'Then I can explain what I found.'
    ].join('\n');

    expect(parseToolRequest(fenced)).toEqual({ tool: 'git_status', args: {} });
    expect(parseToolRequest(prose)).toEqual({
      tool: 'search_files',
      args: { query: 'HelixCode' }
    });
  });

  it('returns null for ordinary assistant text and non-tool JSON', () => {
    expect(parseToolRequest('Here is the answer.')).toBeNull();
    expect(parseToolRequest('{"message":"hello"}')).toBeNull();
  });
});
