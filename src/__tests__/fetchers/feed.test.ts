import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchFeed } from '../../fetchers/feed';

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Blog</title>
    <item>
      <title>New Claude Feature</title>
      <link>https://example.com/claude-feature</link>
      <pubDate>Mon, 30 Mar 2026 08:00:00 +0000</pubDate>
      <description>Claude gets a new feature for coding assistants.</description>
    </item>
    <item>
      <title>Old Article</title>
      <link>https://example.com/old</link>
      <pubDate>Mon, 01 Jan 2024 08:00:00 +0000</pubDate>
      <description>This is old and should be filtered out.</description>
    </item>
    <item>
      <title>CDATA Article</title>
      <link>https://example.com/cdata</link>
      <pubDate>Sun, 29 Mar 2026 08:00:00 +0000</pubDate>
      <description><![CDATA[Article with CDATA content & special chars.]]></description>
    </item>
  </channel>
</rss>`;

const ATOM_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test Atom Feed</title>
  <entry>
    <title>Cursor Update</title>
    <link href="https://example.com/cursor-update" rel="alternate"/>
    <published>2026-03-30T08:00:00Z</published>
    <summary>Cursor releases major update with new agent mode.</summary>
  </entry>
  <entry>
    <title>Old Atom Entry</title>
    <link href="https://example.com/old-atom"/>
    <published>2024-01-01T08:00:00Z</published>
    <summary>Too old to include.</summary>
  </entry>
  <entry>
    <title>Entry With Updated</title>
    <link href="https://example.com/updated-entry"/>
    <updated>2026-03-29T10:00:00Z</updated>
    <content>Uses updated instead of published.</content>
  </entry>
</feed>`;

function mockFetch(xml: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve(xml),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const SINCE = new Date('2026-03-28T00:00:00Z');

describe('fetchFeed — RSS', () => {
  it('parses RSS items correctly', async () => {
    vi.stubGlobal('fetch', mockFetch(RSS_FIXTURE));
    const items = await fetchFeed('https://example.com/rss', 'Test Blog', 'curated', SINCE);
    expect(items).toHaveLength(2); // Old article excluded
    const first = items[0]!;
    expect(first.title).toBe('New Claude Feature');
    expect(first.url).toBe('https://example.com/claude-feature');
    expect(first.sourceName).toBe('Test Blog');
    expect(first.tier).toBe('curated');
    expect(first.publishedAt.toISOString()).toBe('2026-03-30T08:00:00.000Z');
  });

  it('filters out items older than since', async () => {
    vi.stubGlobal('fetch', mockFetch(RSS_FIXTURE));
    const items = await fetchFeed('https://example.com/rss', 'Test Blog', 'curated', SINCE);
    const urls = items.map((i) => i.url);
    expect(urls).not.toContain('https://example.com/old');
  });

  it('handles CDATA in description', async () => {
    vi.stubGlobal('fetch', mockFetch(RSS_FIXTURE));
    const items = await fetchFeed('https://example.com/rss', 'Test Blog', 'curated', SINCE);
    const cdata = items.find((i) => i.url === 'https://example.com/cdata');
    expect(cdata).toBeDefined();
    expect(cdata!.description).toContain('CDATA content');
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve('') }));
    await expect(fetchFeed('https://example.com/rss', 'Test', 'curated', SINCE)).rejects.toThrow('HTTP 404');
  });
});

describe('fetchFeed — Atom', () => {
  it('parses Atom entries correctly', async () => {
    vi.stubGlobal('fetch', mockFetch(ATOM_FIXTURE));
    const items = await fetchFeed('https://example.com/atom', 'Test Atom', 'curated', SINCE);
    expect(items).toHaveLength(2); // Old entry excluded
    const first = items[0]!;
    expect(first.title).toBe('Cursor Update');
    expect(first.url).toBe('https://example.com/cursor-update');
    expect(first.tier).toBe('curated');
  });

  it('falls back to updated when published is absent', async () => {
    vi.stubGlobal('fetch', mockFetch(ATOM_FIXTURE));
    const items = await fetchFeed('https://example.com/atom', 'Test Atom', 'curated', SINCE);
    const updated = items.find((i) => i.title === 'Entry With Updated');
    expect(updated).toBeDefined();
    expect(updated!.publishedAt.toISOString()).toBe('2026-03-29T10:00:00.000Z');
  });

  it('filters out Atom entries older than since', async () => {
    vi.stubGlobal('fetch', mockFetch(ATOM_FIXTURE));
    const items = await fetchFeed('https://example.com/atom', 'Test Atom', 'curated', SINCE);
    const urls = items.map((i) => i.url);
    expect(urls).not.toContain('https://example.com/old-atom');
  });
});
