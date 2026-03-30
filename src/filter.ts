import type { ClaudeAdapter } from './claude';
import type { FeedItem, FilterResult } from './types';

type FilterSignal = 'high' | 'worth_knowing' | 'low';

type ClaudeFilterResponse = {
  index: number;
  signal: FilterSignal;
}[];

function buildFilterPrompt(items: FeedItem[]): string {
  const itemList = items
    .map(
      (item, i) =>
        `[${i}] tier=${item.tier} source="${item.sourceName}"
Title: ${item.title}
URL: ${item.url}
Description: ${item.description.slice(0, 300)}`,
    )
    .join('\n\n');

  return `You are evaluating content items for a daily AI tooling digest targeted at a staff engineer. Classify each item as high signal, worth_knowing, or low based on the criteria below.

HIGH SIGNAL — include and summarise fully:
- New tool releases, features, or APIs with concrete capabilities (Claude Code, Cursor, Copilot, Codex, etc.)
- "I built X with Y" posts showing real workflows or architectures
- Practical tutorials, patterns, or techniques for AI-assisted development
- AI collaboration methodology — spec-driven development, context management, agent configuration
- Meaningful performance improvements or cost reductions in AI tooling
- Changes to pricing, rate limits, or availability that affect daily work
- Workflow tips: prompt engineering, agent configuration, IDE integration
- TypeScript, AWS serverless, or frontend architecture content that is AI-related
- Case studies of engineering teams adopting AI tools at scale

WORTH_KNOWING — include with one sentence:
- Minor updates or incremental improvements to tools
- Interesting observations about AI tooling trends that are less immediately actionable
- Early-stage or limited-availability releases worth tracking

LOW SIGNAL — discard:
- Hype, speculation about AGI timelines, or "AI will replace X" takes
- Fundraising announcements or company drama (unless pricing/availability changes)
- Benchmark comparisons without practical implications
- Philosophical debates about AI safety/alignment (unless actionable)
- Listicles, ragebait, or engagement-farming posts
- Vague product announcements without concrete details
- Content focused purely on ML model training (unless it directly affects tool usage)
- Enterprise sales pitches disguised as blog posts

FILTERING RULES (two-pass for community, single-pass for curated):
- Items with tier="curated" (trusted blogs): skip relevance check, evaluate signal quality only
- Items with tier="community" (HN, Reddit): two-pass — first check relevance to AI tooling/development for practitioners, then evaluate signal quality. Irrelevant items are low signal regardless of quality.

ITEMS TO EVALUATE:
${itemList}

Return ONLY a valid JSON array. No prose, no markdown fences. Every item must appear exactly once.
Format: [{"index": 0, "signal": "high"}, {"index": 1, "signal": "low"}, ...]
Valid signal values: "high", "worth_knowing", "low"`;
}

export async function filterItems(
  items: FeedItem[],
  claude: ClaudeAdapter,
): Promise<FilterResult> {
  if (items.length === 0) {
    return { highSignal: [], worthKnowing: [], filtered: [] };
  }

  const prompt = buildFilterPrompt(items);
  const response = await claude(prompt);

  let parsed: unknown;
  try {
    // Strip potential markdown fences
    const cleaned = response.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    parsed = JSON.parse(cleaned);
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
