import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchReddit } from '../../fetchers/reddit';

const SINCE = new Date('2026-03-28T00:00:00Z');
const SINCE_TS = SINCE.getTime() / 1000;

const REDDIT_FIXTURE = {
  data: {
    children: [
      {
        data: {
          title: 'Claude Code is amazing for TDD',
          url: 'https://example.com/claude-tdd',
          selftext: 'I have been using Claude Code for TDD and it is fantastic.',
          score: 150,
          created_utc: SINCE_TS + 3600, // 1 hour after since
          permalink: '/r/ClaudeAI/comments/abc/claude_code',
        },
      },
      {
        data: {
          title: 'Low score post',
          url: 'https://example.com/low-score',
          selftext: '',
          score: 5,
          created_utc: SINCE_TS + 3600,
          permalink: '/r/ClaudeAI/comments/def/low_score',
        },
      },
      {
        data: {
          title: 'Old post',
          url: 'https://example.com/old-post',
          selftext: '',
          score: 200,
          created_utc: SINCE_TS - 3600, // 1 hour before since
          permalink: '/r/ClaudeAI/comments/ghi/old_post',
        },
      },
    ],
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchReddit', () => {
  it('maps reddit posts to FeedItem correctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(REDDIT_FIXTURE),
    }));
    const items = await fetchReddit('ClaudeAI', 20, SINCE, 'r/ClaudeAI');
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.title).toBe('Claude Code is amazing for TDD');
    expect(item.url).toBe('https://example.com/claude-tdd');
    expect(item.description).toContain('TDD and it is fantastic');
    expect(item.sourceName).toBe('r/ClaudeAI');
    expect(item.tier).toBe('community');
  });

  it('excludes posts below minScore', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(REDDIT_FIXTURE),
    }));
    const items = await fetchReddit('ClaudeAI', 20, SINCE, 'r/ClaudeAI');
    const urls = items.map((i) => i.url);
    expect(urls).not.toContain('https://example.com/low-score');
  });

  it('excludes posts older than since', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(REDDIT_FIXTURE),
    }));
    const items = await fetchReddit('ClaudeAI', 20, SINCE, 'r/ClaudeAI');
    const urls = items.map((i) => i.url);
    expect(urls).not.toContain('https://example.com/old-post');
  });

  it('fetches correct URL with subreddit and params', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { children: [] } }),
    });
    vi.stubGlobal('fetch', mockFetch);
    await fetchReddit('LocalLLaMA', 30, SINCE, 'r/LocalLLaMA');
    const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('reddit.com/r/LocalLLaMA/top.json');
    expect(calledUrl).toContain('t=day');
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, json: () => Promise.resolve({}) }));
    await expect(fetchReddit('ClaudeAI', 20, SINCE, 'r/ClaudeAI')).rejects.toThrow('HTTP 429');
  });
});
