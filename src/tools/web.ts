/**
 * 网络工具：为 Agent 提供 web_search 与 web_fetch。
 *
 * web_search：优先 Tavily（TAVILY_API_KEY）→ Bing API（HELIX_BING_API_KEY）→ HTML 抓取回退。
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
      /** 本会话已搜过相同 query，提示 Agent 勿再调用 */
      duplicateQuery?: boolean;
      query?: string;
      suggestion?: string;
      source?: 'tavily' | 'bing-api' | 'bing-html';
    }
  | { ok: false; error: string; query?: string; suggestion?: string };

const SEARCH_TIMEOUT_MS = 8_000;
const MAX_HTML_RETRIES = 1;
const API_TIMEOUT_MS = 8_000;

/** 单轮对话内去重，避免 Agent 对同一 query 反复搜索 */
const sessionSearchCache = new Map<string, WebToolResult>();

/** 每轮用户输入开始时由 Agent 调用，清空搜索缓存 */
export function clearWebSearchSessionCache(): void {
  sessionSearchCache.clear();
}

const SEARCH_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'about', 'what', 'when', 'where', 'how',
  '的', '是', '在', '和', '与', '了', '吗', '呢', '啊',
]);

// ── web_search ──────────────────────────────────────────────

/** 网页搜索：API 优先，失败则 HTML 抓取 */
export async function webSearchTool(
  query: string,
  count?: number
): Promise<WebToolResult> {
  const q = query.trim();
  if (!q) return { ok: false, error: 'web_search requires a query.' };

  const maxResults = Math.min(Math.max(count ?? WEB_SEARCH_DEFAULT_COUNT, 1), WEB_SEARCH_MAX_COUNT);
  const hasTavilyKey = Boolean(process.env.TAVILY_API_KEY?.trim());
  const hasBingKey = Boolean(process.env.HELIX_BING_API_KEY?.trim());
  const cacheKey = `${normalizeSearchQuery(q)}|${maxResults}`;

  const cached = sessionSearchCache.get(cacheKey);
  if (cached?.ok) {
    return {
      ...cached,
      duplicateQuery: true,
      content: `${cached.content}\n\n[duplicateQuery] This exact query was already searched in the current turn. Do NOT call web_search again with the same or similar query; use the results above or answer from snippets.`,
    };
  }

  // 1) Tavily Search API（推荐，Bing v7 已退役）
  const tavilyKey = process.env.TAVILY_API_KEY?.trim();
  if (tavilyKey) {
    const tavilyResult = await tryTavilyApi(q, maxResults, tavilyKey);
    if (tavilyResult) {
      rememberSearchResult(cacheKey, tavilyResult);
      return tavilyResult;
    }
    // API 错误/超时 → 继续 Bing/HTML 回退
  }

  // 2) Bing Web Search API（旧版，可能已不可用）
  const bingKey = process.env.HELIX_BING_API_KEY?.trim();
  if (bingKey) {
    const apiResult = await tryBingApi(q, maxResults, bingKey);
    if (apiResult && apiResult.ok && apiResult.results?.length) {
      rememberSearchResult(cacheKey, apiResult);
      return apiResult;
    }
  }

  // 3) HTML 抓取（按查询语言选择 cn/www + ensearch 等参数）
  const htmlResult = await scrapeBingHtml(q, maxResults);
  if (htmlResult.ok && htmlResult.results?.length) {
    rememberSearchResult(cacheKey, htmlResult);
    return htmlResult;
  }

  // 4) 明确的无结果反馈，避免 Agent 反复相同查询
  const suggestion = hasTavilyKey || hasBingKey
    ? 'Rephrase the query in the user language, or use web_fetch with a known URL.'
    : 'Rephrase in the user language, set TAVILY_API_KEY for reliable search, or use web_fetch.';

  const noResult: WebToolResult = {
    ok: true,
    noResults: true,
    query: q,
    content: `No web results found for "${q}". Do NOT repeat the same query. Rephrase (prefer user language) or use web_fetch instead.`,
    suggestion,
    ...(htmlResult.ok && htmlResult.source ? { source: htmlResult.source } : {}),
  };
  rememberSearchResult(cacheKey, noResult);
  return noResult;
}

function rememberSearchResult(key: string, result: WebToolResult): void {
  sessionSearchCache.set(key, result);
  if (sessionSearchCache.size > 32) {
    const first = sessionSearchCache.keys().next().value;
    if (first) sessionSearchCache.delete(first);
  }
}

function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ── Tavily Search API ───────────────────────────────────────

interface TavilySearchResponse {
  query?: string;
  answer?: string;
  results?: Array<{
    title: string;
    url: string;
    content: string;
    score?: number;
  }>;
}

async function tryTavilyApi(
  query: string,
  count: number,
  apiKey: string
): Promise<WebToolResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const payload: Record<string, unknown> = {
      api_key: apiKey,
      query: query.slice(0, 400),
      max_results: Math.min(count, 20),
      search_depth: 'basic',
      include_answer: 'basic',
    };
    if (!isMostlyLatinQuery(query)) {
      payload.country = 'china';
    }

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) return null;

    const data = (await response.json()) as TavilySearchResponse;
    const mapped = mapTavilySearchResponse(data, count);
    if (mapped) return mapped;

    return {
      ok: true,
      noResults: true,
      query,
      source: 'tavily',
      content: `Tavily returned no results for "${query}". Rephrase the query or use web_fetch with a URL from a prior search.`,
      suggestion: 'Try different keywords in the user language, or web_fetch a specific site.',
    };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function mapTavilySearchResponse(
  data: TavilySearchResponse,
  count: number
): WebToolResult | null {
  const pages = data.results ?? [];
  if (pages.length === 0) return null;

  const results: WebSearchResult[] = pages.slice(0, count).map((p) => ({
    title: p.title,
    url: p.url,
    snippet: p.content,
  }));

  let content = formatSearchResultsContent(results);
  const answer = data.answer?.trim();
  if (answer) {
    content = `Summary: ${answer}\n\n${content}`;
  }

  return { ok: true, content, results, source: 'tavily' };
}

/** @internal 供单元测试 */
export function mapTavilySearchResponseForTest(
  data: TavilySearchResponse,
  count: number
): WebToolResult | null {
  return mapTavilySearchResponse(data, count);
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
    const mkt = isMostlyLatinQuery(query) ? 'en-US' : 'zh-CN';
    const params = new URLSearchParams({
      q: query,
      count: String(count),
      mkt,
      responseFilter: 'Webpages',
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

/** 按查询语言生成 Bing 搜索 URL（英文查询在 cn.bing 需 ensearch=1） */
function buildBingSearchUrls(query: string): string[] {
  const q = encodeURIComponent(query);
  if (isMostlyLatinQuery(query)) {
    return [
      `https://cn.bing.com/search?q=${q}&ensearch=1`,
      `https://www.bing.com/search?q=${q}&setlang=en-US&cc=US&mkt=en-US`,
    ];
  }
  return [
    `https://cn.bing.com/search?q=${q}`,
    `https://www.bing.com/search?q=${q}&setlang=zh-CN&mkt=zh-CN`,
  ];
}

function isMostlyLatinQuery(query: string): boolean {
  const cjk = (query.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (query.match(/[a-zA-Z]/g) ?? []).length;
  return latin > cjk && latin >= 4;
}

async function scrapeBingHtml(
  query: string,
  maxResults: number
): Promise<WebToolResult> {
  const tried = await tryBingSearchUrls(buildBingSearchUrls(query), query, maxResults);
  if (tried) return tried;

  return { ok: false, error: 'Search failed or no relevant results.', query };
}

async function tryBingSearchUrls(
  urls: string[],
  query: string,
  maxResults: number
): Promise<WebToolResult | null> {
  let lastError = '';

  for (const searchUrl of urls) {
    for (let attempt = 0; attempt <= MAX_HTML_RETRIES; attempt += 1) {
      if (attempt > 0) {
        await sleep(300);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

      try {
        const response = await fetch(searchUrl, {
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html',
            'Accept-Language': isMostlyLatinQuery(query)
              ? 'en-US,en;q=0.9'
              : 'zh-CN,en;q=0.9',
          },
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
          lastError = `Bing returned HTTP ${response.status}`;
          continue;
        }

        const html = await response.text();
        const results = parseBingResults(html, maxResults);

        if (results.length === 0) {
          lastError = `No parseable Bing HTML results for "${query}".`;
          continue;
        }

        if (!looksRelevantToQuery(query, results)) {
          lastError = `Bing results on ${searchUrl} look off-topic for "${query}".`;
          continue;
        }

        const content = formatSearchResultsContent(results);
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

  return null;
}

function formatSearchResultsContent(results: WebSearchResult[]): string {
  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`)
    .join('\n\n');
}

/** 粗判结果是否与 query 相关，过滤「只匹配年份」等明显跑偏 */
function looksRelevantToQuery(query: string, results: WebSearchResult[]): boolean {
  const tokens = extractSearchTokens(query);
  if (tokens.length === 0) return true;

  const blob = results
    .map((r) => `${r.title} ${r.snippet} ${r.url}`.toLowerCase())
    .join(' ');

  // 多个 token 时，纯 4 位年份不能单独撑起相关性
  const substantive = tokens.filter((t) => !/^\d{4}$/.test(t));
  const pool = substantive.length > 0 ? substantive : tokens;

  const hits = pool.filter((t) => blob.includes(t.toLowerCase())).length;
  if (pool.length === 1) return hits >= 1;

  const need = Math.min(pool.length, Math.max(2, Math.ceil(pool.length * 0.4)));
  return hits >= need;
}

function extractSearchTokens(query: string): string[] {
  const trimmed = query.trim();
  const tokens = new Set<string>();

  for (const seg of trimmed.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    tokens.add(seg);
  }

  for (const word of trimmed.toLowerCase().split(/[\s,，、。！？]+/)) {
    const w = word.trim();
    if (w.length > 2 && !SEARCH_STOP_WORDS.has(w)) {
      tokens.add(w);
    }
  }

  return [...tokens];
}

/** 解析 Bing ck/a 跳转链接为真实目标 URL */
function resolveBingResultUrl(rawHref: string): string {
  const href = rawHref.replace(/&amp;/g, '&');
  if (!href.includes('bing.com/ck/a')) return href;

  try {
    const parsed = new URL(href);
    const encoded = parsed.searchParams.get('u');
    if (!encoded) return href;

    const b64 = encoded.startsWith('a1') ? encoded.slice(2) : encoded;
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
      return decoded;
    }
  } catch {
    // 解码失败则保留原链接
  }
  return href;
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

/** 策略 1：解析 `<li class="b_algo">`（新版 Bing：标题在 h2>a，摘要 in b_caption） */
function parseBAlgoStrategy(html: string, maxResults: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const items = html.split(/<li class="b_algo"/i);

  for (const item of items.slice(1, maxResults + 1)) {
    const titleMatch = item.match(
      /<h2[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i
    );
    if (!titleMatch) continue;

    const title = decodeHtmlEntities(stripTags(titleMatch[2] ?? '')).trim();
    const url = resolveBingResultUrl(titleMatch[1] ?? '');
    const snippetMatch =
      item.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ??
      item.match(/<div[^>]*class="[^"]*b_caption[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = snippetMatch
      ? decodeHtmlEntities(stripTags(snippetMatch[1]!)).trim()
      : '';

    if (title && url.startsWith('http') && !isBingNavUrl(url)) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

function isBingNavUrl(url: string): boolean {
  return url.includes('bing.com') || url.includes('microsoft.com/bing');
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
      const title = decodeHtmlEntities(stripTags(linkMatch[2] ?? '')).trim().slice(0, 200);
      const url = resolveBingResultUrl(linkMatch[1] ?? '');

      const snippetMatch = item.match(
        /<p[^>]*>([\s\S]{20,500}?)<\/p>/i
      );
      const snippet = snippetMatch
        ? decodeHtmlEntities(stripTags(snippetMatch[1]!)).trim()
        : '';

      if (title && url.startsWith('http') && !isBingNavUrl(url)) {
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
    const url = resolveBingResultUrl(match[1] ?? '');
    const title = decodeHtmlEntities(stripTags(match[2] ?? '')).trim();

    if (!url.startsWith('http') || seen.has(url) || title.length < 5) continue;
    if (isBingNavUrl(url)) continue;

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
    const url = resolveBingResultUrl(match[1] ?? '');
    const title = decodeHtmlEntities(stripTags(match[2] ?? '')).trim();

    // 过滤导航、分页等无关链接
    if (
      !url.startsWith('http') ||
      seen.has(url) ||
      title.length < 10 ||
      /^(next|previous|page\s+\d|下一页|上一页)$/i.test(title) ||
      isBingNavUrl(url)
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

  const wikiSummary = await tryWikipediaSummary(parsed);
  if (wikiSummary) return wikiSummary;

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

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&ensp;/g, ' ');
}

/** Wikipedia 走 REST Summary API，比直接抓 HTML 更稳 */
async function tryWikipediaSummary(url: URL): Promise<WebToolResult | null> {
  const host = url.hostname.toLowerCase();
  if (!host.endsWith('.wikipedia.org')) return null;

  const wikiIdx = url.pathname.indexOf('/wiki/');
  if (wikiIdx < 0) return null;

  const title = decodeURIComponent(url.pathname.slice(wikiIdx + 6).replace(/_/g, ' '));
  if (!title) return null;

  const lang = host.split('.')[0] ?? 'en';
  const apiUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;

  try {
    const response = await fetch(apiUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      title?: string;
      extract?: string;
      content_urls?: { desktop?: { page?: string } };
    };

    const extract = data.extract?.trim();
    if (!extract) return null;

    const pageUrl = data.content_urls?.desktop?.page ?? url.toString();
    const content = `${data.title ?? title}\nURL: ${pageUrl}\n\n${extract}`;
    return { ok: true, content: content.slice(0, 8000) };
  } catch {
    return null;
  }
}

/** @internal 供单元测试 */
export function parseBingResultsForTest(html: string, maxResults: number): WebSearchResult[] {
  return parseBingResults(html, maxResults);
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
