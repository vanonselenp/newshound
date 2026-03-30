import { describe, it, expect, vi } from 'vitest';
import { fetchAllSources } from '../../fetchers/orchestrator';
import type { Source } from '../../config';
import type { FeedItem } from '../../types';

const SINCE = new Date('2026-03-28T00:00:00Z');

function makeItem(title: string, sourceName: string): FeedItem {
  return {
    title,
    url: `https://example.com/${title.toLowerCase().replace(/ /g, '-')}`,
    publishedAt: new Date('2026-03-30T08:00:00Z'),
    description: 'Test description',
    sourceName,
    tier: 'curated',
  };
}

const RSS_SOURCE: Source = { name: 'Test RSS', type: 'rss', url: 'https://example.com/rss', tier: 'curated' };
const REDDIT_SOURCE: Source = { name: 'r/test', type: 'reddit', subreddit: 'test', minScore: 20, tier: 'community' };
const HN_SOURCE: Source = { name: 'Hacker News', type: 'hn', minScore: 50, tier: 'community' };

describe('fetchAllSources', () => {
  it('returns all items when all sources succeed', async () => {
    const mockFeed = vi.fn().mockResolvedValue([makeItem('RSS Item', 'Test RSS')]);
    const mockReddit = vi.fn().mockResolvedValue([makeItem('Reddit Item', 'r/test')]);
    const mockHN = vi.fn().mockResolvedValue([makeItem('HN Item', 'Hacker News')]);

    const result = await fetchAllSources(
      [RSS_SOURCE, REDDIT_SOURCE, HN_SOURCE],
      SINCE,
      { fetchFeed: mockFeed, fetchReddit: mockReddit, fetchHN: mockHN },
    );

    expect(result.items).toHaveLength(3);
    expect(result.warnings).toHaveLength(0);
    expect(mockFeed).toHaveBeenCalledOnce();
    expect(mockReddit).toHaveBeenCalledOnce();
    expect(mockHN).toHaveBeenCalledOnce();
  });

  it('skips source and adds warning when both attempts fail', async () => {
    const mockFeed = vi.fn().mockRejectedValue(new Error('Network error'));
    const mockReddit = vi.fn().mockResolvedValue([makeItem('Reddit Item', 'r/test')]);
    const mockHN = vi.fn().mockResolvedValue([]);

    const result = await fetchAllSources(
      [RSS_SOURCE, REDDIT_SOURCE, HN_SOURCE],
      SINCE,
      { fetchFeed: mockFeed, fetchReddit: mockReddit, fetchHN: mockHN },
    );

    expect(result.items).toHaveLength(1); // Only reddit item
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Test RSS');
    expect(result.warnings[0]).toContain('Network error');
    // Called twice (original + retry)
    expect(mockFeed).toHaveBeenCalledTimes(2);
  });

  it('succeeds on retry when first attempt fails', async () => {
    let callCount = 0;
    const mockFeed = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('Transient error'));
      return Promise.resolve([makeItem('RSS Item', 'Test RSS')]);
    });

    const result = await fetchAllSources(
      [RSS_SOURCE],
      SINCE,
      { fetchFeed: mockFeed },
    );

    expect(result.items).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
    expect(mockFeed).toHaveBeenCalledTimes(2);
  });

  it('handles source with missing URL gracefully', async () => {
    const noUrlSource: Source = { name: 'No URL', type: 'rss', tier: 'curated' };
    const result = await fetchAllSources([noUrlSource], SINCE, {});
    expect(result.items).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('No URL');
  });

  it('returns empty items and no warnings for empty source list', async () => {
    const result = await fetchAllSources([], SINCE, {});
    expect(result.items).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});
