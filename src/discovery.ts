import { buildCandidate } from './pipeline';
import type { GitHubSource, YouTubeSource } from './config';
import type { Candidate } from './types';

function requireYouTubeBounds(source: YouTubeSource): void {
  const hasQueryBounds = (source.queries?.length ?? 0) > 0 || (source.trustedChannels?.length ?? 0) > 0;
  if (!hasQueryBounds || !source.maxResultsPerQuery) {
    throw new Error('YouTube discovery requires explicit bounds');
  }
}

export async function fetchYouTubeDiscovery(source: YouTubeSource): Promise<Candidate[]> {
  requireYouTubeBounds(source);
  const query = encodeURIComponent(source.queries?.[0] ?? source.trustedChannels?.[0] ?? 'AI');
  const response = await fetch(`https://www.googleapis.com/youtube/v3/search?q=${query}&maxResults=${source.maxResultsPerQuery}`);
  if (!('ok' in response) || !response.ok) {
    throw new Error(`Failed to fetch YouTube discovery for ${source.name}`);
  }
  const json = (await response.json()) as { items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; description?: string; publishedAt?: string; channelTitle?: string } }> };
  return (json.items ?? []).map((item) =>
    buildCandidate({
      title: item.snippet?.title ?? 'Untitled video',
      url: `https://www.youtube.com/watch?v=${item.id?.videoId ?? ''}`,
      canonicalUrl: `https://www.youtube.com/watch?v=${item.id?.videoId ?? ''}`,
      publishedAt: new Date(item.snippet?.publishedAt ?? new Date(0).toISOString()),
      description: item.snippet?.description ?? '',
      snippet: item.snippet?.description ?? '',
      sourceName: item.snippet?.channelTitle ?? source.name,
      sourceType: 'youtube',
      sourceMode: 'discovery',
      tier: source.tier,
      sourceMetadata: { channelTitle: item.snippet?.channelTitle ?? source.name },
      scoreMetadata: {},
    }),
  );
}

function requireGitHubBounds(source: GitHubSource): void {
  const hasTargets = (source.repos?.length ?? 0) > 0 || (source.organisations?.length ?? 0) > 0;
  if (!hasTargets) {
    throw new Error('GitHub discovery requires explicit repo or organisation configuration');
  }
  if (!source.maxResultsPerRun) {
    throw new Error('GitHub discovery requires a per-run result cap');
  }
}

export async function fetchGitHubReleases(source: GitHubSource): Promise<Candidate[]> {
  requireGitHubBounds(source);
  const repos = source.repos ?? [];
  const items: Candidate[] = [];

  for (const repo of repos) {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=${source.maxResultsPerRun}`);
    if (!('ok' in response) || !response.ok) {
      throw new Error(`Failed to fetch GitHub releases for ${repo}`);
    }
    const releases = (await response.json()) as Array<{ html_url?: string; name?: string; body?: string; published_at?: string; repository_url?: string }>;
    for (const release of releases) {
      items.push(
        buildCandidate({
          title: `${repo} ${release.name ?? 'release'}`,
          url: release.html_url ?? `https://github.com/${repo}/releases`,
          canonicalUrl: release.html_url ?? `https://github.com/${repo}/releases`,
          publishedAt: new Date(release.published_at ?? new Date(0).toISOString()),
          description: release.body ?? '',
          snippet: release.body ?? '',
          sourceName: source.name,
          sourceType: 'github',
          sourceMode: 'discovery',
          tier: source.tier,
          sourceMetadata: { repo, repositoryUrl: release.repository_url ?? '' },
          scoreMetadata: {},
        }),
      );
    }
  }

  return items.slice(0, source.maxResultsPerRun);
}
