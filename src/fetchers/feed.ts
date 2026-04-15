import { buildCandidate } from '../pipeline';
import type { Candidate, SourceTier } from '../types';

function extractTag(xml: string, tag: string): string {
  const cdataRe = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
  const cdataMatch = cdataRe.exec(xml);
  if (cdataMatch?.[1] !== undefined) return cdataMatch[1].trim();

  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = re.exec(xml);
  return match?.[1]?.trim() ?? '';
}

function extractAtomLink(block: string): string {
  const alternateRe = /<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i;
  const altMatch = alternateRe.exec(block);
  if (altMatch?.[1]) return altMatch[1];

  const hrefRe = /<link[^>]*href="([^"]+)"/i;
  return hrefRe.exec(block)?.[1] ?? '';
}

function extractBlocks(xml: string, tag: string): string[] {
  const blocks: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    blocks.push(match[0]);
  }
  return blocks;
}

function decodeHtmlEntities(str: string): string {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}

function cleanText(text: string): string {
  return decodeHtmlEntities(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000);
}

function parseDate(value: string): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function isRss(xml: string): boolean {
  return /<rss[\s>]/i.test(xml);
}

function parseRSSItems(xml: string, sourceName: string, tier: SourceTier, since: Date): Candidate[] {
  return extractBlocks(xml, 'item')
    .map((block) => {
      const title = decodeHtmlEntities(extractTag(block, 'title'));
      const url = extractTag(block, 'link').trim();
      const publishedAt = parseDate(extractTag(block, 'pubDate') || extractTag(block, 'dc:date'));
      const description = cleanText(extractTag(block, 'description') || extractTag(block, 'content:encoded'));
      if (!title || !url || publishedAt <= since) return null;
      return buildCandidate({
        title,
        url,
        publishedAt,
        description,
        snippet: description,
        sourceName,
        sourceType: 'rss',
        sourceMode: 'monitored',
        tier,
        sourceMetadata: {},
        scoreMetadata: {},
      });
    })
    .filter((item): item is Candidate => item !== null);
}

function parseAtomEntries(xml: string, sourceName: string, tier: SourceTier, since: Date): Candidate[] {
  return extractBlocks(xml, 'entry')
    .map((block) => {
      const title = decodeHtmlEntities(extractTag(block, 'title'));
      const url = extractAtomLink(block);
      const publishedAt = parseDate(extractTag(block, 'published') || extractTag(block, 'updated'));
      const description = cleanText(extractTag(block, 'summary') || extractTag(block, 'content'));
      if (!title || !url || publishedAt <= since) return null;
      return buildCandidate({
        title,
        url,
        publishedAt,
        description,
        snippet: description,
        sourceName,
        sourceType: 'atom',
        sourceMode: 'monitored',
        tier,
        sourceMetadata: {},
        scoreMetadata: {},
      });
    })
    .filter((item): item is Candidate => item !== null);
}

export async function fetchFeed(url: string, sourceName: string, tier: SourceTier, since: Date): Promise<Candidate[]> {
  const response = await fetch(url, { headers: { 'User-Agent': 'newshound/0.1 (AI digest bot)' } });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  const xml = await response.text();
  return isRss(xml) ? parseRSSItems(xml, sourceName, tier, since) : parseAtomEntries(xml, sourceName, tier, since);
}
