import type { FeedItem } from '../types';

type RedditPost = {
  data: {
    title: string;
    url: string;
    selftext: string;
    score: number;
    created_utc: number;
    permalink: string;
  };
};

type RedditResponse = {
  data: {
    children: RedditPost[];
  };
};

export async function fetchReddit(
  subreddit: string,
  minScore: number,
  since: Date,
  sourceName: string,
): Promise<FeedItem[]> {
  const url = `https://www.reddit.com/r/${subreddit}/top.json?t=day&limit=25`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'newshound/0.1 (AI digest bot)',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Reddit r/${subreddit}: HTTP ${response.status}`);
  }
  const json = (await response.json()) as RedditResponse;
  const sinceTs = since.getTime() / 1000;

  return json.data.children
    .filter((post) => post.data.score >= minScore && post.data.created_utc > sinceTs)
    .map((post) => ({
      title: post.data.title,
      url: post.data.url.startsWith('https://www.reddit.com')
        ? post.data.url
        : post.data.url || `https://www.reddit.com${post.data.permalink}`,
      publishedAt: new Date(post.data.created_utc * 1000),
      description: (post.data.selftext || '').slice(0, 1000),
      sourceName,
      tier: 'community' as const,
    }));
}
