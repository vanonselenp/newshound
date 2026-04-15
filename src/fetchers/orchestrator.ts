import { fetchGitHubReleases, fetchYouTubeDiscovery } from '../discovery';
import type { GitHubSource, HNSource, Source, YouTubeSource } from '../config';
import type { Candidate } from '../types';
import type { SourceRunReport } from '../pipeline';
import { fetchFeed } from './feed';
import { fetchHN } from './hn';
import { fetchReddit } from './reddit';

type FetchFeedFn = (url: string, sourceName: string, tier: 'curated' | 'community', since: Date) => Promise<Candidate[]>;
type FetchRedditFn = (subreddit: string, minScore: number, since: Date, sourceName: string) => Promise<Candidate[]>;
type FetchHNFn = (minScore: number, since: Date, queryTerms: string[]) => Promise<Candidate[]>;
type FetchYouTubeFn = (source: YouTubeSource) => Promise<Candidate[]>;
type FetchGitHubFn = (source: GitHubSource) => Promise<Candidate[]>;

export type FetcherDeps = {
  fetchFeed?: FetchFeedFn;
  fetchReddit?: FetchRedditFn;
  fetchHN?: FetchHNFn;
  fetchYouTubeDiscovery?: FetchYouTubeFn;
  fetchGitHubReleases?: FetchGitHubFn;
};

async function fetchWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return await fn();
  }
}

export async function fetchAllSources(
  sources: Source[],
  since: Date,
  deps: FetcherDeps = {},
): Promise<{ items: Candidate[]; warnings: string[]; sourceReports: SourceRunReport[] }> {
  const feedFn = deps.fetchFeed ?? fetchFeed;
  const redditFn = deps.fetchReddit ?? fetchReddit;
  const hnFn = deps.fetchHN ?? fetchHN;
  const youtubeFn = deps.fetchYouTubeDiscovery ?? fetchYouTubeDiscovery;
  const githubFn = deps.fetchGitHubReleases ?? fetchGitHubReleases;

  const allItems: Candidate[] = [];
  const warnings: string[] = [];
  const sourceReports: SourceRunReport[] = [];

  await Promise.all(
    sources.map(async (source) => {
      try {
        let items: Candidate[] = [];
        if (source.type === 'rss' || source.type === 'atom') {
          const url = source.url;
          if (!url) {
            warnings.push(`Source "${source.name}" has no URL configured`);
            sourceReports.push({ sourceName: source.name, fetched: 0, enriched: 0, deduped: 0, ranked: 0, status: 'failed' });
            return;
          }
          items = await fetchWithRetry(() => feedFn(url, source.name, source.tier, since));
        } else if (source.type === 'reddit') {
          const subreddit = source.subreddit;
          if (!subreddit) {
            warnings.push(`Source "${source.name}" has no subreddit configured`);
            sourceReports.push({ sourceName: source.name, fetched: 0, enriched: 0, deduped: 0, ranked: 0, status: 'failed' });
            return;
          }
          items = await fetchWithRetry(() => redditFn(subreddit, source.minScore ?? 0, since, source.name));
        } else if (source.type === 'hn') {
          const hnSource = source as HNSource;
          items = await fetchWithRetry(() => hnFn(hnSource.minScore ?? 50, since, hnSource.queryTerms ?? []));
        } else if (source.type === 'youtube') {
          items = await fetchWithRetry(() => youtubeFn(source as YouTubeSource));
        } else if (source.type === 'github') {
          items = await fetchWithRetry(() => githubFn(source as GitHubSource));
        }

        allItems.push(...items);
        sourceReports.push({ sourceName: source.name, fetched: items.length, enriched: 0, deduped: 0, ranked: 0, status: 'ok' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`Skipped "${source.name}" after retry: ${message}`);
        sourceReports.push({ sourceName: source.name, fetched: 0, enriched: 0, deduped: 0, ranked: 0, status: 'failed' });
      }
    }),
  );

  return { items: allItems, warnings, sourceReports };
}
