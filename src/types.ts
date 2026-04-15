export type SourceTier = 'curated' | 'community';
export type SourceMode = 'monitored' | 'discovery';
export type CandidateSourceType = 'rss' | 'atom' | 'reddit' | 'hn' | 'youtube' | 'github';
export type RankingBucket = 'must_include' | 'consider' | 'skip';

export type CandidateScores = {
  relevance: number;
  signal: number;
  novelty: number;
  fit: number;
  final: number;
  bucket: RankingBucket;
  reason: string;
};

export type CandidateAlternate = {
  title: string;
  url: string;
  canonicalUrl: string;
  sourceName: string;
  sourceType: CandidateSourceType;
};

export type Candidate = {
  title: string;
  url: string;
  canonicalUrl?: string;
  publishedAt: Date;
  description: string;
  snippet?: string;
  fullText?: string;
  sourceName: string;
  sourceType?: CandidateSourceType;
  sourceMode?: SourceMode;
  tier: SourceTier;
  sourceMetadata?: Record<string, string | number | boolean | null | undefined>;
  scoreMetadata?: Record<string, string | number | boolean | null | undefined>;
  contentFetched?: boolean;
  extractionMethod?: 'html' | 'api';
  extractionError?: string;
  alternates?: CandidateAlternate[];
  scores?: CandidateScores;
};

export type FeedItem = Candidate;

export type FilterResult = {
  highSignal: FeedItem[];
  worthKnowing: FeedItem[];
  filtered: FeedItem[];
};

export type SummaryItem = {
  title: string;
  url: string;
  source: string;
  summary: string;
  takeaway?: string;
};

export type DigestContent = {
  readInFull: SummaryItem[];
  highSignal: SummaryItem[];
  worthKnowing: SummaryItem[];
  tags: string[];
  related: string[];
  sourcesSurveyed: number;
  itemsFiltered: number;
  sourceHealthPercent?: number;
  runHealthGrade?: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  degraded?: boolean;
};
