import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchHN } from '../../fetchers/hn';

const SINCE = new Date('2026-03-28T00:00:00Z');

function makeHit(id: string, title: string, points: number | null, url: string | null, storyText: string | null, createdAt: string) {
  return { objectID: id, title, points, url, story_text: storyText, created_at: createdAt };
}

const ALGOLIA_FIXTURE = {
  hits: [
    makeHit('1', 'Claude Code gets new terminal feature', 120, 'https://example.com/claude-terminal', null, '2026-03-30T08:00:00Z'),
    makeHit('2', 'Low score post about AI', 10, 'https://example.com/low', null, '2026-03-30T07:00:00Z'),
    makeHit('3', 'No URL Ask HN post', 100, null, 'Body of Ask HN post about LLMs', '2026-03-30T06:00:00Z'),
  ],
};

const EMPTY_FIXTURE = { hits: [] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchHN', () => {
  it('maps hits to FeedItem with correct fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(ALGOLIA_FIXTURE),
    }));
    const items = await fetchHN(50, SINCE);
    expect(items.some((i) => i.title === 'Claude Code gets new terminal feature')).toBe(true);
    const item = items.find((i) => i.title === 'Claude Code gets new terminal feature')!;
    expect(item.url).toBe('https://example.com/claude-terminal');
    expect(item.sourceName).toBe('Hacker News');
    expect(item.tier).toBe('community');
  });

  it('excludes hits below minScore', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(ALGOLIA_FIXTURE),
    }));
    const items = await fetchHN(50, SINCE);
    const urls = items.map((i) => i.url);
    expect(urls).not.toContain('https://example.com/low');
  });

  it('falls back to HN item URL when url is null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(ALGOLIA_FIXTURE),
    }));
    const items = await fetchHN(50, SINCE);
    const noUrl = items.find((i) => i.title === 'No URL Ask HN post');
    // objectID is '3' — if it passed score filter (story_text items often have null points)
    // In ALGOLIA_FIXTURE, item 3 has no points field - points will be undefined which is < 50
    // Actually the fixture shows { points: undefined } implicitly since makeHit doesn't set a points value for this
    // Let's verify: the fixture DOES pass points — let me check. makeHit('3', ..., null, null, ...)  —
    // Actually makeHit signature is (id, title, points, url, storyText, createdAt)
    // So hit 3 has points = null... which we need to handle
    // The fixture doesn't have a points field for item 3 — it's null in the type
    // For this test to work, we need a hit that has a high enough score but null url
    // Let me just check the url fallback behavior separately
    expect(noUrl?.url ?? '').toMatch(/news\.ycombinator\.com\/item\?id=3/);
  });

  it('deduplicates hits across keyword queries', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(ALGOLIA_FIXTURE),
      });
    }));
    const items = await fetchHN(50, SINCE);
    // ALGOLIA_FIXTURE is returned for all keyword queries, but items should be deduplicated
    expect(callCount).toBeGreaterThan(1); // Multiple keyword queries made
    const ids = new Set(items.map((i) => i.url));
    expect(ids.size).toBe(items.length); // No duplicate URLs
  });

  it('returns empty array when no hits', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(EMPTY_FIXTURE),
    }));
    const items = await fetchHN(50, SINCE);
    expect(items).toHaveLength(0);
  });
});
