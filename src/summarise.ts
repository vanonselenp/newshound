import type { DigestConfig } from './config';
import type { ClaudeAdapter } from './claude';
import { buildCandidate, buildSummaryPrompt, gradeRunHealth, parseSummaryResponse, type RankedCandidate } from './pipeline';
import type { DigestContent, FilterResult } from './types';

function buildSummaryRepairPrompt(previousResponse: string, digestConfig: DigestConfig): string {
  return `Your previous response was not valid JSON for the ${digestConfig.name} summary step. Convert it into ONLY a valid JSON object with exactly these top-level keys: readInFull, highSignal, worthKnowing, tags, related. Do not include markdown, frontmatter, prose, or code fences.\n\nPrevious response:\n${previousResponse}`;
}

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

  const initialResponse = await claude(buildSummaryPrompt(rankedCandidates, recentDigests, digestConfig));
  let parsed;
  try {
    parsed = parseSummaryResponse(initialResponse, rankedCandidates, isStrictSummaryInput(rankedCandidatesOrFilterResult));
  } catch (error) {
    if (error instanceof Error && error.message.includes('invalid JSON')) {
      const repairedResponse = await claude(buildSummaryRepairPrompt(initialResponse, digestConfig));
      try {
        parsed = parseSummaryResponse(repairedResponse, rankedCandidates, isStrictSummaryInput(rankedCandidatesOrFilterResult));
      } catch (repairError) {
        if (repairError instanceof Error && repairError.message.includes('invalid JSON')) {
          throw new Error(`Failed to parse Claude summarise response as JSON: ${initialResponse.slice(0, 200)}`);
        }
        throw repairError;
      }
    } else {
      throw error;
    }
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
