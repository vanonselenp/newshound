import { stripJsonFences, type ClaudeAdapter } from './claude';
import type { FeedItem, FilterResult } from './types';
import type { FilterCriteria } from './config';

type FilterSignal = 'high' | 'worth_knowing' | 'low';

type ClaudeFilterResponse = {
  index: number;
  signal: FilterSignal;
}[];

export function buildFilterPrompt(items: FeedItem[], criteria: FilterCriteria): string {
  const itemList = items
    .map(
      (item, i) =>
        `[${i}] tier=${item.tier} source="${item.sourceName}"
Title: ${item.title}
URL: ${item.url}
Description: ${item.description.slice(0, 300)}`,
    )
    .join('\n\n');

  const highSignalBullets = criteria.highSignal.map((s) => `- ${s}`).join('\n');
  const worthKnowingBullets = (criteria.worthKnowing ?? []).map((s) => `- ${s}`).join('\n');
  const lowSignalBullets = criteria.lowSignal.map((s) => `- ${s}`).join('\n');

  const profileSection = criteria.profile
    ? `\nUSER PROFILE (filter for fit against this):\n${criteria.profile}\n`
    : '';

  const audienceClause = criteria.audience ? ` targeted at ${criteria.audience}` : '';

  return `You are evaluating content items for a daily ${criteria.purpose} digest${audienceClause}. Classify each item as high signal, worth_knowing, or low based on the criteria below.
${profileSection}
HIGH SIGNAL — include and summarise fully:
${highSignalBullets}

WORTH_KNOWING — include with one sentence:
${worthKnowingBullets || '- Interesting items that do not meet high signal criteria but are worth noting'}

LOW SIGNAL — discard:
${lowSignalBullets}

FILTERING RULES (two-pass for community, single-pass for curated):
- Items with tier="curated" (trusted blogs): skip relevance check, evaluate signal quality only
- Items with tier="community" (HN, Reddit): two-pass — first check relevance to ${criteria.purpose}, then evaluate signal quality. Irrelevant items are low signal regardless of quality.

ITEMS TO EVALUATE:
${itemList}

Return ONLY a valid JSON array. No prose, no markdown fences. Every item must appear exactly once.
Format: [{"index": 0, "signal": "high"}, {"index": 1, "signal": "low"}, ...]
Valid signal values: "high", "worth_knowing", "low"`;
}

export async function filterItems(
  items: FeedItem[],
  criteria: FilterCriteria,
  claude: ClaudeAdapter,
): Promise<FilterResult> {
  if (items.length === 0) {
    return { highSignal: [], worthKnowing: [], filtered: [] };
  }

  const prompt = buildFilterPrompt(items, criteria);
  const response = await claude(prompt);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(response));
  } catch {
    throw new Error(`Failed to parse Claude filter response as JSON: ${response.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Claude filter response is not a JSON array: ${response.slice(0, 200)}`);
  }

  const result: FilterResult = { highSignal: [], worthKnowing: [], filtered: [] };

  for (const entry of parsed as ClaudeFilterResponse) {
    const item = items[entry.index];
    if (!item) continue;
    if (entry.signal === 'high') {
      result.highSignal.push(item);
    } else if (entry.signal === 'worth_knowing') {
      result.worthKnowing.push(item);
    } else {
      result.filtered.push(item);
    }
  }

  return result;
}
