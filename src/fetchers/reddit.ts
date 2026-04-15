import { buildCandidate } from '../pipeline';
import type { Candidate } from '../types';

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

export async function fetchReddit(subreddit: string, minScore: number, since: Date, sourceName: string): Promise<Candidate[]> {
  const response = await fetch(`https://www.reddit.com/r/${subreddit}/top.json?t=day&limit=25`, {
    headers: { 'User-Agent': 'newshound/0.1 (AI digest bot)' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Reddit r/${subreddit}: HTTP ${response.status}`);
  }
  const json = (await response.json()) as RedditResponse;
  const sinceTs = since.getTime() / 1000;
  return json.data.children
    .filter((post) => post.data.score >= minScore && post.data.created_utc > sinceTs)
    .map((post) => {
      const url = post.data.url.startsWith('https://www.reddit.com') ? post.data.url : post.data.url || `https://www.reddit.com${post.data.permalink}`;
      return buildCandidate({
        title: post.data.title,
        url,
        publishedAt: new Date(post.data.created_utc * 1000),
        description: (post.data.selftext || '').slice(0, 1000),
        snippet: (post.data.selftext || '').slice(0, 1000),
        sourceName,
        sourceType: 'reddit',
        sourceMode: 'monitored',
        tier: 'community',
        sourceMetadata: { subreddit },
        scoreMetadata: { score: post.data.score },
      });
    });
}
