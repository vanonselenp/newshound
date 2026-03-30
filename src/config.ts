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
  // Anthropic does not publish an RSS feed — removed until they do
  { name: 'OpenAI Blog', type: 'rss', url: 'https://openai.com/news/rss.xml', tier: 'curated' },
  { name: 'Cursor Changelog', type: 'rss', url: 'https://changelog.cursor.sh/rss', tier: 'curated' },
  { name: 'Vercel Blog', type: 'atom', url: 'https://vercel.com/atom', tier: 'curated' },
  { name: "Simon Willison's Blog", type: 'atom', url: 'https://simonwillison.net/atom/entries/', tier: 'curated' },
  { name: 'Latent Space', type: 'rss', url: 'https://www.latent.space/feed', tier: 'curated' },
  { name: 'Sourcegraph Blog', type: 'rss', url: 'https://sourcegraph.com/blog/rss.xml', tier: 'curated' },
  { name: 'GitHub Blog', type: 'rss', url: 'https://github.blog/feed/', tier: 'curated' },
  { name: 'Hugging Face Blog', type: 'rss', url: 'https://huggingface.co/blog/feed.xml', tier: 'curated' },
  { name: 'Eugene Yan', type: 'rss', url: 'https://eugeneyan.com/rss/', tier: 'curated' },
  { name: 'Hamel Husain', type: 'rss', url: 'https://hamel.dev/index.xml', tier: 'curated' },
  { name: 'Lilian Weng', type: 'rss', url: 'https://lilianweng.github.io/index.xml', tier: 'curated' },
  { name: 'Chip Huyen', type: 'rss', url: 'https://huyenchip.com/feed.xml', tier: 'curated' },
  { name: 'Jason Liu', type: 'rss', url: 'https://jxnl.co/feed_rss_created.xml', tier: 'curated' },
  { name: 'Cloudflare Blog', type: 'rss', url: 'https://blog.cloudflare.com/rss', tier: 'community' },
  // Community sources — two-pass: relevance then signal
  { name: 'Hacker News', type: 'hn', minScore: 50, tier: 'community' },
  { name: 'r/ClaudeAI', type: 'reddit', subreddit: 'ClaudeAI', minScore: 20, tier: 'community' },
  { name: 'r/cursor', type: 'reddit', subreddit: 'cursor', minScore: 20, tier: 'community' },
  { name: 'r/LocalLLaMA', type: 'reddit', subreddit: 'LocalLLaMA', minScore: 30, tier: 'community' },
  { name: 'r/ChatGPT', type: 'reddit', subreddit: 'ChatGPT', minScore: 50, tier: 'community' },
];
