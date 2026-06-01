/**
 * Web tool — web_search and web_fetch for the agent.
 *
 * web_search: Primary path uses Bing Web Search API (HELIX_BING_API_KEY).
 *   Falls back to HTML scraping of cn.bing.com with 4 layered parsing
 *   strategies so a single mark-up change won't break search entirely.
 * web_fetch: fetches a URL and extracts readable text content (blocks private URLs).
 */

import { WEB_SEARCH_DEFAULT_COUNT, WEB_SEARCH_MAX_COUNT } from '../core/constants.js';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type WebToolResult =
  | { ok: true; content: string; results?: WebSearchResult[] }
  | { ok: false; error: string };

const SEARCH_TIMEOUT_MS = 10_000;
const MAX_HTML_RETRIES = 2;
const API_TIMEOUT_MS = 8_000;

// ── web_search ──────────────────────────────────────────────

export async function webSearchTool(
  query: string,
  count?: number
): Promise<WebToolResult> {
  if (!query.trim()) return { ok: false, error: 'web_search requires a query.' };

  const maxResults = Math.min(Math.max(count ?? WEB_SEARCH_DEFAULT_COUNT, 1), WEB_SEARCH_MAX_COUNT);

  // 1) Try Bing Web Search API when a key is configured
  const apiKey = process.env.HELIX_BING_API_KEY?.trim();
  if (apiKey) {
    const apiResult = await tryBingApi(query, maxResults, apiKey);
    if (apiResult) return apiResult;
  }

  // 2) Fall back to HTML scraping
  return scrapeBingHtml(query, maxResults);
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
      // API key invalid or quota exceeded — don't retry, fall through to HTML
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
      return { ok: true, content: `No Bing API results for "${query}".` };
    }

    const results: WebSearchResult[] = pages.slice(0, count).map((p) => ({
      title: p.name,
      url: p.url,
      snippet: p.snippet
    }));

    const content = results
      .map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`)
      .join('\n\n');

    return { ok: true, content, results };
  } catch {
    clearTimeout(timer);
    // Timeout or network error — fall through to HTML
    return null;
  }
}

// ── HTML scraping fallback ──────────────────────────────────

async function scrapeBingHtml(
  query: string,
  maxResults: number
): Promise<WebToolResult> {
  let lastError = '';

  for (let attempt = 0; attempt <= MAX_HTML_RETRIES; attempt += 1) {
    if (attempt > 0) {
      await sleep(250 * Math.pow(2, attempt));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

    try {
      const response = await fetch(
        `https://cn.bing.com/search?q=${encodeURIComponent(query)}`,
        {
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html',
            'Accept-Language': 'zh-CN'
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
        lastError = `No Bing results for "${query}".`;
        return { ok: true, content: lastError };
      }

      const content = results
        .map(
          (r, i) =>
            `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`
        )
        .join('\n\n');

      return { ok: true, content, results };
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

  return { ok: false, error: lastError || 'Search failed.' };
}

// ── Bing HTML parsing strategies ────────────────────────────

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

/** Strategy 1: Bing's `<li class="b_algo">` blocks. */
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

/** Strategy 2: `<ol id="b_results">` container with per-result `<li>` blocks. */
function parseBResultsStrategy(html: string, maxResults: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];

  const olMatch = html.match(
    /<ol[^>]*id="b_results"[^>]*>([\s\S]*?)<\/ol>/i
  );
  if (!olMatch?.[1]) return results;

  const container = olMatch[1];
  const items = container.split(/<li[\s>]/i);

  for (const item of items.slice(1, maxResults + 1)) {
    // Bing uses <h2><a ...>Title</a></h2> for result titles
    const titleMatch = item.match(
      /<h2[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i
    );
    // Fallback: any <a> with an http href and reasonable text
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

/** Strategy 3: Any `<h2>` with a link — common across Bing redesigns. */
function parseH2LinkStrategy(html: string, maxResults: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();

  // Match <h2 ...> <a href="...">text</a> ... </h2> style blocks
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

/** Strategy 4: Generic link extraction — last resort. */
function parseGenericStrategy(html: string, maxResults: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();

  // Match <a href="http...">text</a> with at least 10 chars of text
  const linkRe =
    /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]{10,300}?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRe.exec(html)) !== null) {
    const url = (match[1] ?? '').replace(/&amp;/g, '&');
    const title = stripTags(match[2] ?? '').trim();

    // Filter out navigation / utility links
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

/** Block SSRF targets: non-http(s), localhost, and private IP ranges. */
export function isBlockedFetchUrl(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '0.0.0.0' || host.endsWith('.local')) return true;
  if (host === '::1' || host.startsWith('127.')) return true;

  // IPv4 private ranges
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;

  // IPv6 loopback / link-local / unique-local (simplified)
  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;

  return false;
}
