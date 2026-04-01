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

export type FilterCriteria = {
  purpose: string;
  audience?: string;    // who is this digest for, and why — grounds the filter (e.g. "a staff engineer who wants practical, actionable updates")
  highSignal: string[];
  lowSignal: string[];
  worthKnowing?: string[];
  profile?: string;
};

export type DigestConfig = {
  id: string;
  name: string;
  outputDir: string;
  stateFilePath: string;
  lookbackDays: number;
  sources: Source[];
  filterCriteria: FilterCriteria;
  tags: string[];
  summarisationContext?: string;
};

export type Config = {
  vaultPath: string;
  digests: DigestConfig[];
};
