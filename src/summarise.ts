import type { ClaudeAdapter } from './claude';
import type { DigestContent, FilterResult, SummaryItem } from './types';

const TAG_VOCABULARY = [
  'tooling',
  'models',
  'workflows',
  'pricing',
  'apis',
  'coding-agents',
  'prompting',
  'infrastructure',
  'open-source',
  'releases',
  'ai-methodology',
  'team-practices',
];

function buildSummarisePrompt(
  filterResult: FilterResult,
  totalScanned: number,
  recentDigests: string[],
): string {
  const highSignalList = filterResult.highSignal
    .map(
      (item, i) =>
        `[H${i}] ${item.title} (${item.sourceName})
URL: ${item.url}
${item.description.slice(0, 500)}`,
    )
    .join('\n\n');

  const worthKnowingList = filterResult.worthKnowing
    .map(
      (item, i) =>
        `[W${i}] ${item.title} (${item.sourceName})
URL: ${item.url}
${item.description.slice(0, 200)}`,
    )
    .join('\n\n');

  const recentContext =
    recentDigests.length > 0
      ? `RECENT DIGEST CONTEXT (for detecting related links):\n${recentDigests.join('\n---\n')}`
      : 'RECENT DIGEST CONTEXT: None available.';

  return `You are writing a daily AI Digest for a staff engineer who wants practical, actionable AI tooling updates.

${recentContext}

HIGH SIGNAL ITEMS (write full summaries):
${highSignalList || '(none)'}

WORTH KNOWING ITEMS (one sentence each):
${worthKnowingList || '(none)'}

INSTRUCTIONS:
1. Select 2-3 items for "readInFull" — ones that most reward reading the original beyond the summary. Provide one sentence on WHY to read in full.
2. For all high signal items, write 2-3 sentence summaries explaining what it is and why it matters practically. End each with a "takeaway" (one sentence starting with what the reader could do).
3. For worth knowing items, write a single sentence summary.
4. Select tags from this FIXED LIST ONLY — do not invent new tags: ${TAG_VOCABULARY.join(', ')}
5. If any of today's items are DIRECTLY related to a recent digest (follow-up release, contrasting take, or evolution of the same topic — not just overlapping tags), include that digest date as an Obsidian wikilink in "related". Strong direct connection only, not tag overlap.

Return ONLY valid JSON matching this exact structure — no prose, no markdown fences:
{
  "readInFull": [{"title": "...", "url": "...", "source": "...", "summary": "One sentence on why to read", "takeaway": ""}],
  "highSignal": [{"title": "...", "url": "...", "source": "...", "summary": "2-3 sentences", "takeaway": "One actionable sentence"}],
  "worthKnowing": [{"title": "...", "url": "...", "source": "...", "summary": "One sentence"}],
  "tags": ["tooling"],
  "related": []
}`;
}

function parseSummaryItems(raw: unknown): SummaryItem[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[]).map((item) => ({
    title: String(item['title'] ?? ''),
    url: String(item['url'] ?? ''),
    source: String(item['source'] ?? ''),
    summary: String(item['summary'] ?? ''),
    takeaway: item['takeaway'] !== undefined ? String(item['takeaway']) : undefined,
  }));
}

export async function summariseItems(
  filterResult: FilterResult,
  totalScanned: number,
  recentDigests: string[],
  claude: ClaudeAdapter,
): Promise<DigestContent> {
  const itemsFiltered = filterResult.filtered.length;
  const itemsSurveyed = filterResult.highSignal.length + filterResult.worthKnowing.length;

  if (itemsSurveyed === 0) {
    return {
      readInFull: [],
      highSignal: [],
      worthKnowing: [],
      tags: [],
      related: [],
      sourcesSurveyed: totalScanned,
      itemsFiltered,
    };
  }

  const prompt = buildSummarisePrompt(filterResult, totalScanned, recentDigests);
  const response = await claude(prompt);

  let parsed: unknown;
  try {
    const cleaned = response.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse Claude summarise response as JSON: ${response.slice(0, 200)}`);
  }

  const obj = parsed as Record<string, unknown>;

  return {
    readInFull: parseSummaryItems(obj['readInFull']),
    highSignal: parseSummaryItems(obj['highSignal']),
    worthKnowing: parseSummaryItems(obj['worthKnowing']),
    tags: Array.isArray(obj['tags']) ? (obj['tags'] as string[]).filter((t) => TAG_VOCABULARY.includes(t)) : [],
    related: Array.isArray(obj['related']) ? (obj['related'] as string[]) : [],
    sourcesSurveyed: totalScanned,
    itemsFiltered,
  };
}
