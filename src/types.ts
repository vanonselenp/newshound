export type FeedItem = {
  title: string;
  url: string;
  publishedAt: Date;
  description: string;
  sourceName: string;
  tier: 'curated' | 'community';
};

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
};
