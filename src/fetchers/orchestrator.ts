import type { Source } from '../config';
import type { FeedItem } from '../types';
import { fetchFeed } from './feed';
import { fetchReddit } from './reddit';
import { fetchHN } from './hn';

type FetchFeedFn = (
  url: string,
  sourceName: string,
  tier: 'curated' | 'community',
  since: Date,
) => Promise<FeedItem[]>;

type FetchRedditFn = (
  subreddit: string,
  minScore: number,
  since: Date,
  sourceName: string,
) => Promise<FeedItem[]>;

type FetchHNFn = (minScore: number, since: Date) => Promise<FeedItem[]>;

export type FetcherDeps = {
  fetchFeed?: FetchFeedFn;
  fetchReddit?: FetchRedditFn;
  fetchHN?: FetchHNFn;
};

async function fetchWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    // Retry once
    return await fn();
  }
}

export async function fetchAllSources(
  sources: Source[],
  since: Date,
  deps: FetcherDeps = {},
): Promise<{ items: FeedItem[]; warnings: string[] }> {
  const feedFn = deps.fetchFeed ?? fetchFeed;
  const redditFn = deps.fetchReddit ?? fetchReddit;
  const hnFn = deps.fetchHN ?? fetchHN;

  const allItems: FeedItem[] = [];
  const warnings: string[] = [];

  await Promise.all(
    sources.map(async (source) => {
      try {
        let items: FeedItem[];
        if (source.type === 'rss' || source.type === 'atom') {
          if (!source.url) {
            warnings.push(`Source "${source.name}" has no URL configured`);
            return;
          }
          items = await fetchWithRetry(
            () => feedFn(source.url!, source.name, source.tier, since),
          );
        } else if (source.type === 'reddit') {
          if (!source.subreddit) {
            warnings.push(`Source "${source.name}" has no subreddit configured`);
            return;
          }
          items = await fetchWithRetry(
            () => redditFn(source.subreddit!, source.minScore ?? 0, since, source.name),
          );
        } else if (source.type === 'hn') {
          items = await fetchWithRetry(
            () => hnFn(source.minScore ?? 50, since),
          );
        } else {
          warnings.push(`Source "${source.name}" has unknown type: ${(source as Source).type}`);
          return;
        }
        allItems.push(...items);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`Skipped "${source.name}" after retry: ${msg}`);
      }
    }),
  );

  return { items: allItems, warnings };
}
