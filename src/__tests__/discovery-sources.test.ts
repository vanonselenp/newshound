import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGitHubReleases, fetchYouTubeDiscovery } from '../discovery';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('discovery sources', () => {
  it('requires explicit bounds for YouTube discovery', async () => {
    await expect(
      fetchYouTubeDiscovery({
        name: 'YouTube',
        type: 'youtube',
        mode: 'discovery',
        tier: 'community',
        lookbackHours: 24,
        queries: [],
      }),
    ).rejects.toThrow('explicit bounds');
  });

  it('maps bounded YouTube results into shared candidates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        items: [
          {
            id: { videoId: 'abc123' },
            snippet: {
              title: 'Claude Code video',
              description: 'Hands-on workflow',
              publishedAt: '2026-03-30T09:00:00Z',
              channelTitle: 'Trusted Channel',
            },
          },
        ],
      }),
    }));

    const items = await fetchYouTubeDiscovery({
      name: 'YouTube',
      type: 'youtube',
      mode: 'discovery',
      tier: 'community',
      lookbackHours: 24,
      queries: ['Claude Code'],
      maxResultsPerQuery: 5,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.sourceType).toBe('youtube');
    expect(items[0]?.sourceMode).toBe('discovery');
  });

  it('requires explicit GitHub bounds and maps releases into shared candidates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        {
          html_url: 'https://github.com/org/repo/releases/tag/v1',
          name: 'v1.0.0',
          body: 'Release notes',
          published_at: '2026-03-30T09:00:00Z',
          repository_url: 'https://api.github.com/repos/org/repo',
        },
      ]),
    }));

    await expect(
      fetchGitHubReleases({
        name: 'GitHub Releases',
        type: 'github',
        mode: 'discovery',
        tier: 'curated',
        lookbackHours: 24,
        repos: [],
      }),
    ).rejects.toThrow('explicit repo or organisation configuration');

    const items = await fetchGitHubReleases({
      name: 'GitHub Releases',
      type: 'github',
      mode: 'discovery',
      tier: 'curated',
      lookbackHours: 24,
      repos: ['org/repo'],
      maxResultsPerRun: 3,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.sourceType).toBe('github');
  });
});
