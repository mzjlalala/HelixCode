/**
 * Web tool — web_search and web_fetch for the agent.
 *
 * web_search: Bing (cn.bing.com) — accessible in China, no API key needed.
 * web_fetch: fetches a URL and extracts readable text content.
 */

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type WebToolResult =
  | { ok: true; content: string; results?: WebSearchResult[] }
  | { ok: false; error: string };

const SEARCH_TIMEOUT_MS = 8000;

export async function webSearchTool(
  query: string,
  _count?: number
): Promise<WebToolResult> {
  if (!query.trim()) return { ok: false, error: 'web_search requires a query.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const response = await fetch(`https://cn.bing.com/search?q=${encodeURIComponent(query)}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'zh-CN'
      },
      signal: controller.signal
    });

    clearTimeout(timer);

    if (!response.ok) {
      return { ok: false, error: `Bing returned HTTP ${response.status}` };
    }

    const html = await response.text();

    // Parse Bing results
    const results: WebSearchResult[] = [];

    // Bing uses <li class="b_algo"> for results
    const items = html.split('<li class="b_algo"');
    for (const item of items.slice(1, 10)) {
      const linkMatch = item.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const snippetMatch = item.match(/<p[^>]*>([\s\S]*?)<\/p>/);

      if (linkMatch) {
        const title = stripTags(linkMatch[2] ?? '').trim();
        const url = linkMatch[1]!.replace(/&amp;/g, '&');
        const snippet = snippetMatch ? stripTags(snippetMatch[1]!).trim() : '';
        if (title) results.push({ title, url, snippet });
      }
    }

    if (results.length === 0) {
      return { ok: true, content: `No Bing results for "${query}".` };
    }

    const content = results.map((r, i) =>
      `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`
    ).join('\n\n');

    return { ok: true, content, results };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('abort') || msg.includes('timeout')) {
      return { ok: false, error: 'Search timed out. Check your internet connection and try again.' };
    }
    return { ok: false, error: `Search failed: ${msg}` };
  }
}

export async function webFetchTool(urlString: string): Promise<WebToolResult> {
  if (!urlString.trim()) return { ok: false, error: 'web_fetch requires a URL.' };

  try {
    new URL(urlString);
  } catch {
    return { ok: false, error: `Invalid URL: ${urlString}` };
  }

  try {
    const response = await fetch(urlString, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,text/plain,application/json,*/*'
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` };
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
      text = text.slice(0, maxLen) + `\n\n... (truncated, full content is ${text.length} chars)`;
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

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

const BLOCK_TAGS = ['script', 'style', 'nav', 'footer', 'header', 'noscript'];
const BLOCK_RE = new RegExp(`<(${BLOCK_TAGS.join('|')})[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi');

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
