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

// Shape of a digest YAML file — id is derived from the filename, stateFilePath defaults to ~/.newshound/state/{id}.json
export type DigestFileConfig = {
  name: string;
  outputDir: string;
  stateFilePath?: string;
  lookbackDays: number;
  sources: Source[];
  filterCriteria: FilterCriteria;
  tags: string[];
  summarisationContext?: string;
};

// Runtime shape after id and stateFilePath are resolved by the config loader
export type DigestConfig = DigestFileConfig & {
  id: string;
  stateFilePath: string;
};

export type Config = {
  vaultPath: string;
  digests: DigestConfig[];
};
