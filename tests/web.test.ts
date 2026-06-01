import { describe, expect, it } from 'vitest';
import { isBlockedFetchUrl } from '../src/tools/web.js';

describe('web_fetch SSRF guard', () => {
  it('blocks localhost and private IP ranges', () => {
    expect(isBlockedFetchUrl(new URL('http://localhost/path'))).toBe(true);
    expect(isBlockedFetchUrl(new URL('http://127.0.0.1/path'))).toBe(true);
    expect(isBlockedFetchUrl(new URL('http://10.0.0.1/path'))).toBe(true);
    expect(isBlockedFetchUrl(new URL('http://192.168.1.1/path'))).toBe(true);
    expect(isBlockedFetchUrl(new URL('http://172.16.0.1/path'))).toBe(true);
  });

  it('blocks non-http(s) schemes', () => {
    expect(isBlockedFetchUrl(new URL('file:///etc/passwd'))).toBe(true);
    expect(isBlockedFetchUrl(new URL('ftp://example.com/file'))).toBe(true);
  });

  it('allows public https URLs', () => {
    expect(isBlockedFetchUrl(new URL('https://example.com/docs'))).toBe(false);
    expect(isBlockedFetchUrl(new URL('http://8.8.8.8/'))).toBe(false);
  });
});
