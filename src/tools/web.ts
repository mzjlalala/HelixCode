/**
 * 网络工具：为 Agent 提供 web_search 与 web_fetch。
 *
 * web_search：优先使用 Bing API（HELIX_BING_API_KEY）；
 *   否则抓取 cn.bing.com，并用 4 层解析策略降低页面改版导致整站失效的风险。
 * web_fetch：抓取 URL 并提取可读文本，拦截内网/私有地址（SSRF 防护）。
 */

import { WEB_SEARCH_DEFAULT_COUNT, WEB_SEARCH_MAX_COUNT } from '../core/constants.js';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type WebToolResult =
  | {
      ok: true;
      content: string;
      results?: WebSearchResult[];
      /** 无匹配结果时为 true，提示 Agent 勿重复相同查询 */
      noResults?: boolean;
      query?: string;
      suggestion?: string;
      source?: 'bing-api' | 'bing-html';
    }
  | { ok: false; error: string; query?: string; suggestion?: string };

const SEARCH_TIMEOUT_MS = 10_000;
const MAX_HTML_RETRIES = 2;
const API_TIMEOUT_MS = 8_000;

// ── web_search ──────────────────────────────────────────────

/** 网页搜索：API 优先，失败则 HTML 抓取 */
export async function webSearchTool(
  query: string,
  count?: number
): Promise<WebToolResult> {
  const q = query.trim();
  if (!q) return { ok: false, error: 'web_search requires a query.' };

  const maxResults = Math.min(Math.max(count ?? WEB_SEARCH_DEFAULT_COUNT, 1), WEB_SEARCH_MAX_COUNT);
  const hasBingKey = Boolean(process.env.HELIX_BING_API_KEY?.trim());

  // 1) 配置了密钥时走 Bing Web Search API
  const apiKey = process.env.HELIX_BING_API_KEY?.trim();
  if (apiKey) {
    const apiResult = await tryBingApi(q, maxResults, apiKey);
    if (apiResult && apiResult.ok && apiResult.results?.length) return apiResult;
    // API 无结果或失败 → 继续 HTML 回退
  }

  // 2) HTML 抓取（cn.bing.com → www.bing.com）
  const htmlResult = await scrapeBingHtml(q, maxResults);
  if (htmlResult.ok && htmlResult.results?.length) return htmlResult;

  // 3) 明确的无结果反馈，避免 Agent 反复相同查询
  const suggestion = hasBingKey
    ? 'Try a shorter or English query, or use web_fetch with a known URL.'
    : 'Set HELIX_BING_API_KEY for reliable results, rephrase the query, or use web_fetch with a known URL.';

  return {
    ok: true,
    noResults: true,
    query: q,
    content: `No web results found for "${q}". Do not repeat the same query; rephrase or use web_fetch instead.`,
    suggestion,
    ...(htmlResult.ok && htmlResult.source ? { source: htmlResult.source } : {})
  };
}

// ── Bing Web Search API ─────────────────────────────────────

async function tryBingApi(
  query: string,
  count: number,
  apiKey: string
): Promise<WebToolResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const params = new URLSearchParams({
      q: query,
      count: String(count),
      mkt: 'zh-CN',
      responseFilter: 'Webpages'
    });

    const response = await fetch(
      `https://api.bing.microsoft.com/v7.0/search?${params}`,
      {
        headers: {
          'Ocp-Apim-Subscription-Key': apiKey,
          'Accept': 'application/json'
        },
        signal: controller.signal
      }
    );

    clearTimeout(timer);

    if (!response.ok) {
      // 密钥无效或配额用尽 — 不重试，交给 HTML 回退
      return null;
    }

    const data = await response.json() as {
      webPages?: {
        value?: Array<{
          name: string;
          url: string;
          snippet: string;
        }>;
      };
    };

    const pages = data.webPages?.value ?? [];
    if (pages.length === 0) {
      return null;
    }

    const results: WebSearchResult[] = pages.slice(0, count).map((p) => ({
      title: p.name,
      url: p.url,
      snippet: p.snippet
    }));

    const content = results
      .map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`)
      .join('\n\n');

    return { ok: true, content, results, source: 'bing-api' };
  } catch {
    clearTimeout(timer);
    // 超时或网络错误 — 交给 HTML 回退
    return null;
  }
}

// ── HTML scraping fallback ──────────────────────────────────

async function scrapeBingHtml(
  query: string,
  maxResults: number
): Promise<WebToolResult> {
  const hosts = ['https://cn.bing.com/search', 'https://www.bing.com/search'];
  let lastError = '';

  for (const host of hosts) {
    for (let attempt = 0; attempt <= MAX_HTML_RETRIES; attempt += 1) {
      if (attempt > 0) {
        await sleep(250 * Math.pow(2, attempt));
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

      try {
        const response = await fetch(
          `${host}?q=${encodeURIComponent(query)}`,
          {
            method: 'GET',
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html',
              'Accept-Language': 'zh-CN,en;q=0.9'
            },
            signal: controller.signal
          }
        );

        clearTimeout(timer);

        if (!response.ok) {
          lastError = `Bing returned HTTP ${response.status}`;
          continue;
        }

        const html = await response.text();
        const results = parseBingResults(html, maxResults);

        if (results.length === 0) {
          lastError = `No parseable Bing HTML results for "${query}" on ${host}.`;
          continue;
        }

        const content = results
          .map(
            (r, i) =>
              `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`
          )
          .join('\n\n');

        return { ok: true, content, results, source: 'bing-html' };
      } catch (error) {
        clearTimeout(timer);
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('abort') || msg.includes('timeout')) {
          lastError = 'Search timed out.';
        } else {
          lastError = `Search failed: ${msg}`;
        }
      }
    }
  }

  return { ok: false, error: lastError || 'Search failed.', query };
}

// ── Bing HTML parsing strategies ────────────────────────────

/** 依次尝试多种 HTML 解析策略，直至得到结果 */
function parseBingResults(html: string, maxResults: number): WebSearchResult[] {
  const strategies = [
    parseBAlgoStrategy,
    parseBResultsStrategy,
    parseH2LinkStrategy,
    parseGenericStrategy
  ];

  for (const strategy of strategies) {
    const results = strategy(html, maxResults);
    if (results.length > 0) return results;
  }

  return [];
}

/** 策略 1：解析 `<li class="b_algo">` 结果块 */
function parseBAlgoStrategy(html: string, maxResults: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const items = html.split('<li class="b_algo"');

  for (const item of items.slice(1, maxResults + 1)) {
    const linkMatch = item.match(
      /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/
    );
    const snippetMatch = item.match(/<p[^>]*>([\s\S]*?)<\/p>/);

    if (linkMatch) {
      const title = stripTags(linkMatch[2] ?? '').trim();
      const url = (linkMatch[1] ?? '').replace(/&amp;/g, '&');
      const snippet = snippetMatch
        ? stripTags(snippetMatch[1]!).trim()
        : '';
      if (title) results.push({ title, url, snippet });
    }
  }

  return results;
}

/** 策略 2：解析 `<ol id="b_results">` 内的 `<li>` 条目 */
function parseBResultsStrategy(html: string, maxResults: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];

  const olMatch = html.match(
    /<ol[^>]*id="b_results"[^>]*>([\s\S]*?)<\/ol>/i
  );
  if (!olMatch?.[1]) return results;

  const container = olMatch[1];
  const items = container.split(/<li[\s>]/i);

  for (const item of items.slice(1, maxResults + 1)) {
    // 标题通常在 <h2><a> 中
    const titleMatch = item.match(
      /<h2[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i
    );
    // 回退：任意带 http href 且文本长度合理的 <a>
    const fallbackMatch = item.match(
      /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]{5,200}?)<\/a>/i
    );
    const linkMatch = titleMatch ?? fallbackMatch;

    if (linkMatch) {
      const title = stripTags(linkMatch[2] ?? '').trim().slice(0, 200);
      const url = (linkMatch[1] ?? '').replace(/&amp;/g, '&');

      const snippetMatch = item.match(
        /<p[^>]*>([\s\S]{20,500}?)<\/p>/i
      );
      const snippet = snippetMatch
        ? stripTags(snippetMatch[1]!).trim()
        : '';

      if (title && url.startsWith('http')) {
        results.push({ title, url, snippet });
      }
    }
  }

  return results;
}

/** 策略 3：任意带链接的 `<h2>`（改版后常见） */
function parseH2LinkStrategy(html: string, maxResults: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();

  const h2Re = /<h2[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/gi;
  let match: RegExpExecArray | null;

  while ((match = h2Re.exec(html)) !== null) {
    const url = (match[1] ?? '').replace(/&amp;/g, '&');
    const title = stripTags(match[2] ?? '').trim();

    if (!url.startsWith('http') || seen.has(url) || title.length < 5) continue;
    if (url.includes('bing.com') || url.includes('microsoft.com/bing')) continue;

    seen.add(url);
    results.push({ title, url, snippet: '' });
    if (results.length >= maxResults) break;
  }

  return results;
}

/** 策略 4：通用链接提取（最后手段） */
function parseGenericStrategy(html: string, maxResults: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();

  const linkRe =
    /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]{10,300}?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRe.exec(html)) !== null) {
    const url = (match[1] ?? '').replace(/&amp;/g, '&');
    const title = stripTags(match[2] ?? '').trim();

    // 过滤导航、分页等无关链接
    if (
      !url.startsWith('http') ||
      seen.has(url) ||
      title.length < 10 ||
      /^(next|previous|page\s+\d|下一页|上一页)$/i.test(title) ||
      url.includes('bing.com') ||
      url.includes('microsoft.com/bing')
    ) {
      continue;
    }

    seen.add(url);
    results.push({ title, url, snippet: '' });
    if (results.length >= maxResults) break;
  }

  return results;
}

// ── web_fetch ───────────────────────────────────────────────

/** 抓取 URL 正文（HTML 去标签），长度上限约 8000 字符 */
export async function webFetchTool(urlString: string): Promise<WebToolResult> {
  if (!urlString.trim()) return { ok: false, error: 'web_fetch requires a URL.' };

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { ok: false, error: `Invalid URL: ${urlString}` };
  }

  if (isBlockedFetchUrl(parsed)) {
    return { ok: false, error: `Blocked URL (private or unsupported scheme): ${urlString}` };
  }

  try {
    const response = await fetch(parsed.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,text/plain,application/json,*/*'
      },
      signal: AbortSignal.timeout(15_000)
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    const raw = await response.text();

    let text: string;
    if (contentType.includes('text/html')) {
      text = stripHtml(raw);
    } else {
      text = raw;
    }

    const maxLen = 8000;
    if (text.length > maxLen) {
      text =
        text.slice(0, maxLen) +
        `\n\n... (truncated, full content is ${text.length} chars)`;
    }

    return { ok: true, content: text };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('aborted') || msg.includes('timeout')) {
      return { ok: false, error: `Request timed out: ${urlString}` };
    }
    return { ok: false, error: `Failed to fetch ${urlString}: ${msg}` };
  }
}

// ── HTML helpers ────────────────────────────────────────────

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

const BLOCK_TAGS = ['script', 'style', 'nav', 'footer', 'header', 'noscript'];
const BLOCK_RE = new RegExp(
  `<(${BLOCK_TAGS.join('|')})[^>]*>[\\s\\S]*?<\\/\\1>`,
  'gi'
);

function stripHtml(html: string): string {
  return html
    .replace(BLOCK_RE, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
    .replace(/\n{4,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 拦截 SSRF：非 http(s)、localhost、私有网段等 */
export function isBlockedFetchUrl(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '0.0.0.0' || host.endsWith('.local')) return true;
  if (host === '::1' || host.startsWith('127.')) return true;

  // IPv4 私有地址段
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;

  // IPv6 回环 / 链路本地 / ULA（简化判断）
  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;

  return false;
}
