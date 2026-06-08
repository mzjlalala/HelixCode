import { describe, expect, it } from 'vitest';
import { isBlockedFetchUrl, parseBingResultsForTest } from '../src/tools/web.js';

const BING_FIXTURE = `<li class="b_algo" data-id><div class="b_tpcn"><a class="tilk" href="https://baike.baidu.com/item/%E4%B8%96%E7%95%8C%E6%9D%AF%E6%8F%AD%E5%B9%95%E6%88%98/67560290"><div class="tptt">baidu.com</div><cite>https://baike.baidu.com › item › 世界杯揭幕战</cite></a></div><h2 class=""><a href="https://baike.baidu.com/item/%E4%B8%96%E7%95%8C%E6%9D%AF%E6%8F%AD%E5%B9%95%E6%88%98/67560290"><strong>世界杯揭幕战</strong>_百度百科</a></h2><div class="b_caption"><p class="b_lineclamp2">2026年美加墨世界杯的揭幕战是本届赛事的开幕比赛，定于2026年6月11日举行。</p></div></li>`;

describe('Bing HTML parsing', () => {
  it('parses h2 title instead of tilk site link', () => {
    const results = parseBingResultsForTest(BING_FIXTURE, 3);
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toContain('世界杯揭幕战');
    expect(results[0]?.title).not.toContain('baidu.comhttps');
    expect(results[0]?.snippet).toContain('2026年6月11日');
  });
});

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
