import type { FeedItem } from '../types';

// Extract first match of a tag's text content, handling CDATA
function extractTag(xml: string, tag: string): string {
  const cdataRe = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
  const cdataMatch = cdataRe.exec(xml);
  if (cdataMatch?.[1] !== undefined) return cdataMatch[1].trim();

  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = re.exec(xml);
  return match?.[1]?.trim() ?? '';
}

// Extract href attribute from the first <link> tag in a block (Atom)
function extractAtomLink(block: string): string {
  const alternateRe = /<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i;
  const altMatch = alternateRe.exec(block);
  if (altMatch?.[1]) return altMatch[1];

  const hrefRe = /<link[^>]*href="([^"]+)"/i;
  const hrefMatch = hrefRe.exec(block);
  return hrefMatch?.[1] ?? '';
}

// Split XML into top-level blocks for a given tag
function extractBlocks(xml: string, tag: string): string[] {
  const blocks: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  let match;
  while ((match = re.exec(xml)) !== null) {
    blocks.push(match[0]);
  }
  return blocks;
}

function parseRSSDate(dateStr: string): Date {
  if (!dateStr) return new Date(0);
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

function parseAtomDate(dateStr: string): Date {
  if (!dateStr) return new Date(0);
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function isRss(xml: string): boolean {
  return /<rss[\s>]/i.test(xml);
}

function parseRSSItems(
  xml: string,
  sourceName: string,
  tier: 'curated' | 'community',
  since: Date,
): FeedItem[] {
  const items: FeedItem[] = [];
  for (const block of extractBlocks(xml, 'item')) {
    const title = decodeHtmlEntities(extractTag(block, 'title'));
    const url = extractTag(block, 'link').trim();
    const pubDateStr = extractTag(block, 'pubDate') || extractTag(block, 'dc:date');
    const publishedAt = parseRSSDate(pubDateStr);
    if (publishedAt <= since) continue;
    const description = decodeHtmlEntities(
      extractTag(block, 'description') || extractTag(block, 'content:encoded'),
    )
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000);
    if (!title || !url) continue;
    items.push({ title, url, publishedAt, description, sourceName, tier });
  }
  return items;
}

function parseAtomEntries(
  xml: string,
  sourceName: string,
  tier: 'curated' | 'community',
  since: Date,
): FeedItem[] {
  const items: FeedItem[] = [];
  for (const block of extractBlocks(xml, 'entry')) {
    const title = decodeHtmlEntities(extractTag(block, 'title'));
    const url = extractAtomLink(block);
    const publishedStr = extractTag(block, 'published') || extractTag(block, 'updated');
    const publishedAt = parseAtomDate(publishedStr);
    if (publishedAt <= since) continue;
    const description = decodeHtmlEntities(
      extractTag(block, 'summary') || extractTag(block, 'content'),
    )
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000);
    if (!title || !url) continue;
    items.push({ title, url, publishedAt, description, sourceName, tier });
  }
  return items;
}

export async function fetchFeed(
  url: string,
  sourceName: string,
  tier: 'curated' | 'community',
  since: Date,
): Promise<FeedItem[]> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'newshound/0.1 (AI digest bot)' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  const xml = await response.text();
  return isRss(xml)
    ? parseRSSItems(xml, sourceName, tier, since)
    : parseAtomEntries(xml, sourceName, tier, since);
}
