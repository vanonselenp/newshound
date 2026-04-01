import type { ClaudeAdapter } from './claude';
import type { DigestContent, FilterResult, SummaryItem } from './types';
import type { DigestConfig } from './config';

function buildSummarisePrompt(
  filterResult: FilterResult,
  totalScanned: number,
  recentDigests: string[],
  digestConfig: DigestConfig,
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

  const profileSection = digestConfig.filterCriteria.profile
    ? `\nUSER PROFILE:\n${digestConfig.filterCriteria.profile}\n`
    : '';

  const extraContext = digestConfig.summarisationContext ? `\n${digestConfig.summarisationContext}` : '';

  return `You are writing a daily ${digestConfig.name} for a practitioner who wants practical, actionable updates.
${profileSection}
${recentContext}

HIGH SIGNAL ITEMS (write full summaries):
${highSignalList || '(none)'}

WORTH KNOWING ITEMS (one sentence each):
${worthKnowingList || '(none)'}

INSTRUCTIONS:
1. Select 2-3 items for "readInFull" — ones that most reward reading the original beyond the summary. Provide one sentence on WHY to read in full.
2. For high signal items, include no more than 5 — focus on the most relevant and practically useful. Write 2-3 sentence summaries explaining what it is and why it matters. End each with a "takeaway" (one sentence starting with what the reader could do).
3. For worth knowing items, write a single sentence summary. Include no more than 5 — pick the most noteworthy if there are more.
4. Select tags from this FIXED LIST ONLY — do not invent new tags: ${digestConfig.tags.join(', ')}
5. If any of today's items are DIRECTLY related to a recent digest (follow-up release, contrasting take, or evolution of the same topic — not just overlapping tags), include that digest date as an Obsidian wikilink in "related". Strong direct connection only, not tag overlap.
${extraContext}
Return ONLY valid JSON matching this exact structure — no prose, no markdown fences:
{
  "readInFull": [{"title": "...", "url": "...", "source": "...", "summary": "One sentence on why to read", "takeaway": ""}],
  "highSignal": [{"title": "...", "url": "...", "source": "...", "summary": "2-3 sentences", "takeaway": "One actionable sentence"}],
  "worthKnowing": [{"title": "...", "url": "...", "source": "...", "summary": "One sentence"}],
  "tags": ["${digestConfig.tags[0] ?? 'tag'}"],
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
  digestConfig: DigestConfig,
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

  const prompt = buildSummarisePrompt(filterResult, totalScanned, recentDigests, digestConfig);
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
    highSignal: parseSummaryItems(obj['highSignal']).slice(0, 5),
    worthKnowing: parseSummaryItems(obj['worthKnowing']).slice(0, 5),
    tags: Array.isArray(obj['tags'])
      ? (obj['tags'] as string[]).filter((t) => digestConfig.tags.includes(t))
      : [],
    related: Array.isArray(obj['related']) ? (obj['related'] as string[]) : [],
    sourcesSurveyed: totalScanned,
    itemsFiltered,
  };
}
