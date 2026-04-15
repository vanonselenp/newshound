import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import type { CandidateBudget, DigestConfig, FilterCriteria } from './config';
import { stripJsonFences, type ClaudeAdapter } from './claude';
import type { Candidate, CandidateScores, DigestContent, RankingBucket, SummaryItem } from './types';

export type RankedCandidate = Candidate & { scores: CandidateScores };

export type RunOptions = CandidateBudget;

export type SourceRunReport = {
  sourceName: string;
  fetched: number;
  enriched: number;
  deduped: number;
  ranked: number;
  status: 'ok' | 'failed';
};

export type RunReport = {
  digestId: string;
  generatedAt: Date;
  sourceReports: SourceRunReport[];
};

type SummaryResponse = Pick<DigestContent, 'readInFull' | 'highSignal' | 'worthKnowing' | 'tags' | 'related'>;

export function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith('utm_')) parsed.searchParams.delete(key);
    }
    parsed.hash = '';
    if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    const search = parsed.searchParams.toString();
    return `${parsed.origin}${parsed.pathname}${search ? `?${search}` : ''}`;
  } catch {
    return url;
  }
}

export function buildCandidate(input: Partial<Candidate> & { title: string; url: string; sourceName: string; tier?: Candidate['tier'] }): Candidate {
  const snippet = input.snippet ?? input.description ?? input.title;
  return {
    title: input.title,
    url: input.url,
    canonicalUrl: input.canonicalUrl ?? canonicalizeUrl(input.url),
    publishedAt: input.publishedAt ?? new Date('2026-03-30T08:00:00Z'),
    description: input.description ?? snippet,
    snippet,
    fullText: input.fullText,
    sourceName: input.sourceName,
    sourceType: input.sourceType ?? 'rss',
    sourceMode: input.sourceMode ?? 'monitored',
    tier: input.tier ?? 'curated',
    sourceMetadata: input.sourceMetadata ?? {},
    scoreMetadata: input.scoreMetadata ?? {},
    contentFetched: input.contentFetched,
    extractionMethod: input.extractionMethod,
    extractionError: input.extractionError,
    alternates: input.alternates,
    scores: input.scores,
  };
}

export function buildDigestRunOptions(overrides: Partial<RunOptions> = {}): RunOptions {
  return {
    maxRawCandidatesPerRun: overrides.maxRawCandidatesPerRun ?? 200,
    maxFullTextFetchesPerRun: overrides.maxFullTextFetchesPerRun ?? 25,
    maxRankedCandidatesForClaude: overrides.maxRankedCandidatesForClaude ?? 20,
  };
}

function extractHtmlText(html: string): string {
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const body = articleMatch?.[1] ?? html;
  return body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function enrichCandidates(candidates: Candidate[], options: RunOptions): Promise<Candidate[]> {
  const eligible = candidates.filter((candidate) => candidate.tier === 'curated' || candidate.sourceMode === 'discovery');
  const direct = candidates.filter((candidate) => candidate.tier === 'curated');
  const boundedCommunity = candidates.filter((candidate) => candidate.tier === 'community').slice(0, Math.max(0, options.maxFullTextFetchesPerRun - direct.length));
  const selected = new Set([...eligible, ...boundedCommunity].slice(0, options.maxFullTextFetchesPerRun));

  return Promise.all(
    candidates.map(async (candidate) => {
      if (!selected.has(candidate)) {
        return { ...candidate, contentFetched: false };
      }

      try {
        const response = await fetch(candidate.url);
        const html = await response.text();
        const fullText = extractHtmlText(html);
        if (!fullText) {
          return { ...candidate, contentFetched: false, extractionMethod: 'html', extractionError: 'empty extraction' };
        }
        return { ...candidate, fullText, contentFetched: true, extractionMethod: 'html' };
      } catch (error) {
        return {
          ...candidate,
          contentFetched: false,
          extractionError: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}

function normalizeTitle(title: string): string[] {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function titlesAreNearDuplicate(left: string, right: string): boolean {
  const a = new Set(normalizeTitle(left));
  const b = new Set(normalizeTitle(right));
  if (a.size === 0 || b.size === 0) return false;
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  const smaller = Math.min(a.size, b.size);
  return overlap / smaller >= 0.75;
}

export function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const clusters: Candidate[] = [];

  for (const candidate of candidates) {
    const canonicalCandidate = { ...candidate, canonicalUrl: canonicalizeUrl(candidate.canonicalUrl || candidate.url) };
    const existing = clusters.find(
      (cluster) =>
        cluster.canonicalUrl === canonicalCandidate.canonicalUrl || titlesAreNearDuplicate(cluster.title, canonicalCandidate.title),
    );

    if (!existing) {
      clusters.push({ ...canonicalCandidate, alternates: [] });
      continue;
    }

    existing.alternates = [
      ...(existing.alternates ?? []),
      {
        title: canonicalCandidate.title,
        url: canonicalCandidate.url,
        canonicalUrl: canonicalCandidate.canonicalUrl,
        sourceName: canonicalCandidate.sourceName,
        sourceType: canonicalCandidate.sourceType ?? 'rss',
      },
    ];
  }

  return clusters;
}

function freshnessScore(candidate: Candidate, now: Date): number {
  const ageHours = Math.max(0, (now.getTime() - candidate.publishedAt.getTime()) / (60 * 60 * 1000));
  return Math.max(0, 10 - Math.floor(ageHours / 12));
}

function trustScore(candidate: Candidate): number {
  return candidate.tier === 'curated' ? 2 : 0;
}

function buildRankingPrompt(candidates: Candidate[], criteria?: FilterCriteria): string {
  const purpose = criteria?.purpose ?? 'AI tooling';
  const items = candidates
    .map((candidate, index) => `[${index}] ${candidate.title}\nURL: ${candidate.canonicalUrl ?? candidate.url}\nSource: ${candidate.sourceName}\nText: ${(candidate.fullText ?? candidate.snippet ?? candidate.description).slice(0, 1200)}`)
    .join('\n\n');
  return `Rank these candidate stories for a ${purpose} digest. Return ONLY valid JSON array. Every index must appear exactly once.\nValid buckets: must_include, consider, skip.\nFormat: [{"index":0,"relevance":0-10,"signal":0-10,"novelty":0-10,"fit":0-10,"final":0-10,"bucket":"must_include","reason":"why"}]\n\n${items}`;
}

function parseScore(value: unknown, field: string): number {
  if (typeof value !== 'number' || value < 0 || value > 10) {
    throw new Error(`Ranking response contains out-of-range ${field}`);
  }
  return value;
}

export function parseRankingResponse(response: string, expectedCount: number): CandidateScores[] & { index?: never }[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(response));
  } catch {
    throw new Error('Ranking response contains invalid JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Ranking response must be a JSON array');
  }

  const seen = new Set<number>();
  const results = new Array<CandidateScores>(expectedCount);

  for (const entry of parsed as Array<Record<string, unknown>>) {
    const index = entry['index'];
    if (typeof index !== 'number' || index < 0 || index >= expectedCount) {
      throw new Error('Ranking response contains invalid indexes');
    }
    if (seen.has(index)) {
      throw new Error('Ranking response contains duplicate indexes');
    }
    seen.add(index);

    const bucket = entry['bucket'];
    if (bucket !== 'must_include' && bucket !== 'consider' && bucket !== 'skip') {
      throw new Error('Ranking response contains invalid bucket');
    }

    results[index] = {
      relevance: parseScore(entry['relevance'], 'relevance'),
      signal: parseScore(entry['signal'], 'signal'),
      novelty: parseScore(entry['novelty'], 'novelty'),
      fit: parseScore(entry['fit'], 'fit'),
      final: parseScore(entry['final'], 'final'),
      bucket: bucket as RankingBucket,
      reason: String(entry['reason'] ?? ''),
    };
  }

  if (seen.size !== expectedCount) {
    throw new Error('Ranking response contains missing indexes');
  }

  return results;
}

export async function rankCandidates(candidates: Candidate[], options: RunOptions, claude: ClaudeAdapter, now: Date, criteria?: FilterCriteria): Promise<RankedCandidate[]> {
  const bounded = [...candidates]
    .sort((left, right) => (freshnessScore(right, now) + trustScore(right)) - (freshnessScore(left, now) + trustScore(left)))
    .slice(0, options.maxRankedCandidatesForClaude);

  if (bounded.length === 0) return [];

  const response = await claude(buildRankingPrompt(bounded, criteria));
  const scores = parseRankingResponse(response, bounded.length);
  return bounded
    .map((candidate, index) => ({
      ...candidate,
      scores: scores[index]!,
    }))
    .sort((left, right) => right.scores.final - left.scores.final);
}

function parseSummaryItem(raw: unknown): SummaryItem {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Summary response contains invalid summary item');
  }
  const record = raw as Record<string, unknown>;
  if (typeof record['title'] !== 'string' || typeof record['url'] !== 'string' || typeof record['source'] !== 'string' || typeof record['summary'] !== 'string') {
    throw new Error('Summary response contains invalid summary item');
  }
  return {
    title: record['title'],
    url: record['url'],
    source: record['source'],
    summary: record['summary'],
    takeaway: typeof record['takeaway'] === 'string' ? record['takeaway'] : undefined,
  };
}

export function parseSummaryResponse(response: string, rankedCandidates: RankedCandidate[], strict: boolean = true): SummaryResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(response));
  } catch {
    throw new Error('Summary response contains invalid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Summary response must be an object');
  }
  const obj = parsed as Record<string, unknown>;
  const urls = new Set(rankedCandidates.map((candidate) => candidate.url));
  const parseList = (value: unknown): SummaryItem[] => {
    if (!Array.isArray(value)) {
      throw new Error('Summary response contains invalid list fields');
    }
    return value.map((entry) => {
      const item = parseSummaryItem(entry);
      if (strict && !urls.has(item.url)) {
        throw new Error('Summary response references unknown candidate');
      }
      return item;
    });
  };
  if (!Array.isArray(obj['tags']) || !Array.isArray(obj['related'])) {
    throw new Error('Summary response contains invalid structured fields');
  }
  return {
    readInFull: parseList(obj['readInFull']),
    highSignal: parseList(obj['highSignal']),
    worthKnowing: parseList(obj['worthKnowing']),
    tags: (obj['tags'] as unknown[]).filter((tag): tag is string => typeof tag === 'string'),
    related: (obj['related'] as unknown[]).filter((link): link is string => typeof link === 'string'),
  };
}

export function gradeRunHealth(sourceHealthPercent: number): { grade: DigestContent['runHealthGrade']; degraded: boolean } {
  if (sourceHealthPercent > 90) return { grade: 'A', degraded: false };
  if (sourceHealthPercent > 80) return { grade: 'B', degraded: true };
  if (sourceHealthPercent > 70) return { grade: 'C', degraded: true };
  if (sourceHealthPercent > 60) return { grade: 'D', degraded: true };
  if (sourceHealthPercent > 50) return { grade: 'E', degraded: true };
  return { grade: 'F', degraded: true };
}

export async function writeRunReport(baseDir: string, report: RunReport): Promise<string> {
  await mkdir(baseDir, { recursive: true });
  const filename = `${report.digestId}-${report.generatedAt.toISOString().split('T')[0]}.json`;
  const filepath = join(baseDir, filename);
  const okCount = report.sourceReports.filter((entry) => entry.status === 'ok').length;
  const sourceHealthPercent = report.sourceReports.length === 0 ? 100 : Math.round((okCount / report.sourceReports.length) * 100);
  const health = gradeRunHealth(sourceHealthPercent);
  await writeFile(
    filepath,
    JSON.stringify({
      ...report,
      generatedAt: report.generatedAt.toISOString(),
      totals: {
        fetched: report.sourceReports.reduce((sum, entry) => sum + entry.fetched, 0),
        enriched: report.sourceReports.reduce((sum, entry) => sum + entry.enriched, 0),
        deduped: report.sourceReports.reduce((sum, entry) => sum + entry.deduped, 0),
        ranked: report.sourceReports.reduce((sum, entry) => sum + entry.ranked, 0),
      },
      sourceHealthPercent,
      runHealthGrade: health.grade,
      degraded: health.degraded,
    }),
    'utf-8',
  );
  return filepath;
}

export function buildSummaryPrompt(rankedCandidates: RankedCandidate[], recentDigests: string[], digestConfig: DigestConfig): string {
  const items = rankedCandidates
    .map(
      (candidate, index) =>
        `[${index}] ${candidate.title} (${candidate.sourceName})\nURL: ${candidate.url}\nBucket: ${candidate.scores?.bucket ?? 'consider'}\nReason: ${candidate.scores?.reason ?? 'n/a'}\nText: ${(candidate.fullText ?? candidate.snippet ?? candidate.description).slice(0, 1600)}`,
    )
    .join('\n\n');
  const recent = recentDigests.length > 0 ? recentDigests.join('\n---\n') : 'None';
  const extraContext = digestConfig.summarisationContext ? `\n${digestConfig.summarisationContext}` : '';
  return `You are writing a daily ${digestConfig.name} for a practitioner who wants practical, actionable updates. Use fullText when present and snippet otherwise.\nRECENT DIGEST CONTEXT:\n${recent}${extraContext}\nChoose top unique stories from the ranked candidates below. Return ONLY JSON with keys readInFull, highSignal, worthKnowing, tags, related. Tags must come from: ${digestConfig.tags.join(', ')}\n\n${items}`;
}
