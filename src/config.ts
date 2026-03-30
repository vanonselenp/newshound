export type SourceType = 'rss' | 'atom' | 'reddit' | 'hn';
export type SourceTier = 'curated' | 'community';

export type Source = {
  name: string;
  type: SourceType;
  url?: string;
  subreddit?: string;
  minScore?: number;
  tier: SourceTier;
};

export type Config = {
  vaultPath: string;
  stateFilePath: string;
  lookbackDays: number;
};

export const DEFAULT_SOURCES: Source[] = [
  // Curated blogs — go straight to signal evaluation
  { name: 'Anthropic Blog', type: 'rss', url: 'https://www.anthropic.com/rss.xml', tier: 'curated' },
  { name: 'OpenAI Blog', type: 'rss', url: 'https://openai.com/news/rss/', tier: 'curated' },
  { name: 'Cursor Changelog', type: 'rss', url: 'https://changelog.cursor.sh/rss', tier: 'curated' },
  { name: 'Vercel Blog', type: 'atom', url: 'https://vercel.com/atom', tier: 'curated' },
  { name: "Simon Willison's Blog", type: 'atom', url: 'https://simonwillison.net/atom/entries/', tier: 'curated' },
  { name: 'Latent Space', type: 'rss', url: 'https://www.latent.space/feed', tier: 'curated' },
  // Community sources — two-pass: relevance then signal
  { name: 'Hacker News', type: 'hn', minScore: 50, tier: 'community' },
  { name: 'r/ClaudeAI', type: 'reddit', subreddit: 'ClaudeAI', minScore: 20, tier: 'community' },
  { name: 'r/cursor', type: 'reddit', subreddit: 'cursor', minScore: 20, tier: 'community' },
  { name: 'r/LocalLLaMA', type: 'reddit', subreddit: 'LocalLLaMA', minScore: 30, tier: 'community' },
  { name: 'r/ChatGPT', type: 'reddit', subreddit: 'ChatGPT', minScore: 50, tier: 'community' },
];
