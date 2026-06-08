import { describe, expect, it } from 'vitest';
import { parseCompactArg } from '../src/cli/slash-commands.js';

describe('parseCompactArg', () => {
  it('defaults to token mode', () => {
    expect(parseCompactArg('')).toEqual({ mode: 'tokens', targetTokens: 0 });
    expect(parseCompactArg('auto')).toEqual({ mode: 'tokens', targetTokens: 0 });
  });

  it('parses Nk as token budget', () => {
    expect(parseCompactArg('40k')).toEqual({ mode: 'tokens', targetTokens: 40_000 });
  });

  it('parses small integers as message count', () => {
    expect(parseCompactArg('20')).toEqual({ mode: 'messages', keep: 20 });
  });

  it('parses large integers as token budget', () => {
    expect(parseCompactArg('50000')).toEqual({ mode: 'tokens', targetTokens: 50_000 });
  });
});
