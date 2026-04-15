import type { CandidateSourceType, SourceMode, SourceTier } from './types';

export type SourceType = CandidateSourceType;

type SourceBase = {
  name: string;
  type: SourceType;
  tier: SourceTier;
  mode?: SourceMode;
};

export type FeedSource = SourceBase & {
  type: 'rss' | 'atom';
  url?: string;
};

export type RedditSource = SourceBase & {
  type: 'reddit';
  subreddit?: string;
  minScore?: number;
};

export type HNSource = SourceBase & {
  type: 'hn';
  minScore?: number;
  queryTerms?: string[];
};

export type YouTubeSource = SourceBase & {
  type: 'youtube';
  lookbackHours: number;
  queries?: string[];
  trustedChannels?: string[];
  maxResultsPerQuery?: number;
};

export type GitHubSource = SourceBase & {
  type: 'github';
  lookbackHours: number;
  repos?: string[];
  organisations?: string[];
  maxResultsPerRun?: number;
};

export type Source = FeedSource | RedditSource | HNSource | YouTubeSource | GitHubSource;

export type CandidateBudget = {
  maxRawCandidatesPerRun: number;
  maxFullTextFetchesPerRun: number;
  maxRankedCandidatesForClaude: number;
};

export type FilterCriteria = {
  purpose: string;
  audience?: string;
  highSignal: string[];
  lowSignal: string[];
  worthKnowing?: string[];
  profile?: string;
};

export type DigestFileConfig = {
  name: string;
  outputDir: string;
  stateFilePath?: string;
  lookbackDays: number;
  sources: Source[];
  filterCriteria: FilterCriteria;
  tags: string[];
  summarisationContext?: string;
  candidateBudget?: Partial<CandidateBudget>;
};

export type DigestConfig = Omit<DigestFileConfig, 'candidateBudget'> & {
  id: string;
  stateFilePath: string;
  candidateBudget?: CandidateBudget;
};

export type Config = {
  vaultPath: string;
  digests: DigestConfig[];
};
