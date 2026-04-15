import type { DigestConfig } from './config';
import type { ClaudeAdapter } from './claude';
import { buildCandidate, buildSummaryPrompt, gradeRunHealth, parseSummaryResponse, type RankedCandidate } from './pipeline';
import type { DigestContent, FilterResult } from './types';

function toRankedCandidates(input: RankedCandidate[] | FilterResult): RankedCandidate[] {
  if (Array.isArray(input)) return input;
  return [...input.highSignal, ...input.worthKnowing].map((candidate, index) => ({
    ...buildCandidate({
      title: candidate.title,
      url: candidate.url,
      publishedAt: candidate.publishedAt,
      description: candidate.description,
      snippet: candidate.snippet ?? candidate.description,
      sourceName: candidate.sourceName,
      sourceType: candidate.sourceType ?? 'rss',
      sourceMode: candidate.sourceMode ?? 'monitored',
      tier: candidate.tier,
      sourceMetadata: candidate.sourceMetadata ?? {},
      scoreMetadata: candidate.scoreMetadata ?? {},
    }),
    scores: {
      relevance: 8,
      signal: 8,
      novelty: 7,
      fit: 8,
      final: 8 - index,
      bucket: index < input.highSignal.length ? 'must_include' : 'consider',
      reason: 'legacy filtered candidate',
    },
  }));
}

function isStrictSummaryInput(input: RankedCandidate[] | FilterResult): boolean {
  return Array.isArray(input);
}

function getFilteredCount(input: RankedCandidate[] | FilterResult, totalScanned: number): number {
  if (Array.isArray(input)) {
    return Math.max(0, totalScanned - input.length);
  }
  return input.filtered.length;
}

export async function summariseItems(
  rankedCandidatesOrFilterResult: RankedCandidate[] | FilterResult,
  totalScanned: number,
  recentDigests: string[],
  digestConfig: DigestConfig,
  claude: ClaudeAdapter,
  sourceHealthPercent: number = 100,
): Promise<DigestContent> {
  const rankedCandidates = toRankedCandidates(rankedCandidatesOrFilterResult);
  const filteredCount = getFilteredCount(rankedCandidatesOrFilterResult, totalScanned);
  const health = gradeRunHealth(sourceHealthPercent);

  if (rankedCandidates.length === 0) {
    return {
      readInFull: [],
      highSignal: [],
      worthKnowing: [],
      tags: [],
      related: [],
      sourcesSurveyed: totalScanned,
      itemsFiltered: filteredCount,
      sourceHealthPercent,
      runHealthGrade: health.grade,
      degraded: health.degraded,
    };
  }

  const response = await claude(buildSummaryPrompt(rankedCandidates, recentDigests, digestConfig));
  let parsed;
  try {
    parsed = parseSummaryResponse(response, rankedCandidates, isStrictSummaryInput(rankedCandidatesOrFilterResult));
  } catch (error) {
    if (error instanceof Error && error.message.includes('invalid JSON')) {
      throw new Error(`Failed to parse Claude summarise response as JSON: ${response.slice(0, 200)}`);
    }
    throw error;
  }

  return {
    readInFull: parsed.readInFull,
    highSignal: parsed.highSignal.slice(0, 5),
    worthKnowing: parsed.worthKnowing.slice(0, 5),
    tags: parsed.tags.filter((tag) => digestConfig.tags.includes(tag)),
    related: parsed.related,
    sourcesSurveyed: totalScanned,
    itemsFiltered: filteredCount,
    sourceHealthPercent,
    runHealthGrade: health.grade,
    degraded: health.degraded,
  };
}
