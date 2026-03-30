import type { FeedItem } from '../types';

const HN_KEYWORDS = ['Claude', 'LLM', 'Cursor', 'Copilot', 'ChatGPT', 'Gemini', 'llama', 'AI coding'];

type AlgoliaHit = {
  objectID: string;
  title: string;
  url: string | null;
  story_text: string | null;
  points: number | null;
  created_at: string;
};

type AlgoliaResponse = {
  hits: AlgoliaHit[];
};

async function searchHN(
  keyword: string,
  minScore: number,
  since: Date,
): Promise<AlgoliaHit[]> {
  const sinceTs = Math.floor(since.getTime() / 1000);
  const params = new URLSearchParams({
    query: keyword,
    tags: 'story',
    numericFilters: `points>=${minScore},created_at_i>=${sinceTs}`,
    hitsPerPage: '50',
  });
  const url = `https://hn.algolia.com/api/v1/search_by_date?${params.toString()}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'newshound/0.1 (AI digest bot)' },
  });
  if (!response.ok) {
    throw new Error(`HN Algolia API error for "${keyword}": HTTP ${response.status}`);
  }
  const json = (await response.json()) as AlgoliaResponse;
  return json.hits;
}

export async function fetchHN(minScore: number, since: Date): Promise<FeedItem[]> {
  const allHits = await Promise.all(
    HN_KEYWORDS.map((keyword) => searchHN(keyword, minScore, since)),
  );

  // Deduplicate by objectID
  const seen = new Set<string>();
  const deduplicated: AlgoliaHit[] = [];
  for (const hits of allHits) {
    for (const hit of hits) {
      if (!seen.has(hit.objectID)) {
        seen.add(hit.objectID);
        deduplicated.push(hit);
      }
    }
  }

  const aboveThreshold = deduplicated.filter((hit) => (hit.points ?? 0) >= minScore && new Date(hit.created_at) > since);

  return aboveThreshold.map((hit) => ({
    title: hit.title,
    url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
    publishedAt: new Date(hit.created_at),
    description: (hit.story_text ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000),
    sourceName: 'Hacker News',
    tier: 'community' as const,
  }));
}
