import { buildCandidate } from '../pipeline';
import type { Candidate } from '../types';

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

async function searchHN(keyword: string, minScore: number, since: Date): Promise<AlgoliaHit[]> {
  const sinceTs = Math.floor(since.getTime() / 1000);
  const params = new URLSearchParams({
    query: keyword,
    tags: 'story',
    numericFilters: `points>=${minScore},created_at_i>=${sinceTs}`,
    hitsPerPage: '50',
  });
  const response = await fetch(`https://hn.algolia.com/api/v1/search_by_date?${params.toString()}`, {
    headers: { 'User-Agent': 'newshound/0.1 (AI digest bot)' },
  });
  if (!response.ok) {
    throw new Error(`HN Algolia API error for "${keyword}": HTTP ${response.status}`);
  }
  return ((await response.json()) as AlgoliaResponse).hits;
}

const DEFAULT_QUERY_TERMS = ['Claude', 'LLM', 'Cursor', 'Copilot', 'ChatGPT', 'Gemini', 'llama', 'AI coding'];

export async function fetchHN(minScore: number, since: Date, queryTerms: string[] = DEFAULT_QUERY_TERMS): Promise<Candidate[]> {
  const allHits = await Promise.all(queryTerms.map((keyword) => searchHN(keyword, minScore, since)));
  const seen = new Set<string>();
  const deduped = allHits.flat().filter((hit) => {
    if (seen.has(hit.objectID)) return false;
    seen.add(hit.objectID);
    return true;
  });

  return deduped
    .filter((hit) => (hit.points ?? 0) >= minScore && new Date(hit.created_at) > since)
    .map((hit) =>
      buildCandidate({
        title: hit.title,
        url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
        publishedAt: new Date(hit.created_at),
        description: (hit.story_text ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000),
        snippet: (hit.story_text ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000),
        sourceName: 'Hacker News',
        sourceType: 'hn',
        sourceMode: 'monitored',
        tier: 'community',
        sourceMetadata: { objectID: hit.objectID },
        scoreMetadata: { points: hit.points ?? 0 },
      }),
    );
}
