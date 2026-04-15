import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCandidate,
  buildDigestRunOptions,
  dedupeCandidates,
  enrichCandidates,
  gradeRunHealth,
  parseRankingResponse,
  parseSummaryResponse,
  rankCandidates,
  writeRunReport,
  type RankedCandidate,
} from '../pipeline';

const NOW = new Date('2026-03-30T12:00:00Z');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pipeline stages', () => {
  it('enriches curated items, records extraction details, and falls back on failure', async () => {
    const okHtml = '<html><body><article><p>Full article body for testing.</p></article></body></html>';
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(okHtml) })
      .mockRejectedValueOnce(new Error('timeout'));
    vi.stubGlobal('fetch', mockFetch);

    const candidates = [
      buildCandidate({ title: 'Curated One', url: 'https://example.com/a', sourceName: 'Feed', tier: 'curated' }),
      buildCandidate({ title: 'Curated Two', url: 'https://example.com/b', sourceName: 'Feed', tier: 'curated' }),
    ];

    const enriched = await enrichCandidates(candidates, buildDigestRunOptions({ maxFullTextFetchesPerRun: 2 }));

    expect(enriched[0]?.contentFetched).toBe(true);
    expect(enriched[0]?.extractionMethod).toBe('html');
    expect(enriched[0]?.fullText).toContain('Full article body');
    expect(enriched[1]?.contentFetched).toBe(false);
    expect(enriched[1]?.extractionError).toContain('timeout');
    expect(enriched[1]?.snippet).toBeTruthy();
  });

  it('canonicalises URLs and clusters exact and near-duplicate stories', () => {
    const clusters = dedupeCandidates([
      buildCandidate({
        title: 'Claude Code adds terminal mode',
        url: 'https://example.com/story?utm_source=x',
        canonicalUrl: 'https://example.com/story?utm_source=x',
        sourceName: 'Feed',
      }),
      buildCandidate({
        title: 'Claude Code adds terminal mode',
        url: 'https://example.com/story#section',
        sourceName: 'HN',
        tier: 'community',
      }),
      buildCandidate({
        title: 'Claude Code gets new terminal mode',
        url: 'https://another.example.com/post',
        sourceName: 'Reddit',
        tier: 'community',
      }),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.alternates).toHaveLength(2);
    expect(clusters[0]?.canonicalUrl).toBe('https://example.com/story');
  });

  it('parses strict ranking responses and rejects duplicates, omissions, bad buckets, and score ranges', () => {
    expect(() => parseRankingResponse('not json', 1)).toThrow('invalid JSON');
    expect(() =>
      parseRankingResponse(
        JSON.stringify([{ index: 0, relevance: 5, signal: 5, novelty: 5, fit: 5, final: 5, bucket: 'bad', reason: 'x' }]),
        1,
      ),
    ).toThrow('invalid bucket');
    expect(() =>
      parseRankingResponse(
        JSON.stringify([
          { index: 0, relevance: 5, signal: 5, novelty: 5, fit: 5, final: 5, bucket: 'must_include', reason: 'x' },
          { index: 0, relevance: 5, signal: 5, novelty: 5, fit: 5, final: 5, bucket: 'consider', reason: 'x' },
        ]),
        2,
      ),
    ).toThrow('duplicate indexes');
    expect(() =>
      parseRankingResponse(
        JSON.stringify([{ index: 0, relevance: 11, signal: 5, novelty: 5, fit: 5, final: 5, bucket: 'must_include', reason: 'x' }]),
        1,
      ),
    ).toThrow('out-of-range');
    expect(() =>
      parseRankingResponse(
        JSON.stringify([{ index: 0, relevance: 5, signal: 5, novelty: 5, fit: 5, final: 5, bucket: 'must_include', reason: 'x' }]),
        2,
      ),
    ).toThrow('missing indexes');
  });

  it('ranks only the bounded candidate count and keeps structured scores', async () => {
    const claude = vi.fn().mockResolvedValue(
      JSON.stringify([
        { index: 0, relevance: 9, signal: 8, novelty: 6, fit: 9, final: 8, bucket: 'must_include', reason: 'fresh and trusted' },
        { index: 1, relevance: 7, signal: 7, novelty: 6, fit: 8, final: 7, bucket: 'consider', reason: 'solid update' },
      ]),
    );
    const ranked = await rankCandidates(
      [
        buildCandidate({ title: 'A', url: 'https://example.com/a', sourceName: 'Feed' }),
        buildCandidate({ title: 'B', url: 'https://example.com/b', sourceName: 'Feed' }),
        buildCandidate({ title: 'C', url: 'https://example.com/c', sourceName: 'Feed' }),
      ],
      buildDigestRunOptions({ maxRankedCandidatesForClaude: 2 }),
      claude,
      NOW,
    );

    expect(claude).toHaveBeenCalledOnce();
    const prompt = claude.mock.calls[0]?.[0] as string;
    expect(prompt).toContain('[0]');
    expect(prompt).toContain('[1]');
    expect(prompt).not.toContain('https://example.com/c');
    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.scores.bucket).toBe('must_include');
  });

  it('rejects malformed summary responses instead of silently accepting them', () => {
    const ranked: RankedCandidate[] = [
      {
        ...buildCandidate({ title: 'A', url: 'https://example.com/a', sourceName: 'Feed' }),
        scores: { relevance: 9, signal: 8, novelty: 7, fit: 9, final: 8, bucket: 'must_include', reason: 'x' },
      },
    ];

    expect(() => parseSummaryResponse('not json', ranked)).toThrow('invalid JSON');
    expect(() => parseSummaryResponse(JSON.stringify({ readInFull: [{}], highSignal: [], worthKnowing: [], tags: [], related: [] }), ranked)).toThrow('invalid summary item');
  });

  it('grades run health from source-health percentage and writes a machine-readable report', async () => {
    expect(gradeRunHealth(91)).toEqual({ grade: 'A', degraded: false });
    expect(gradeRunHealth(81)).toEqual({ grade: 'B', degraded: true });
    expect(gradeRunHealth(50)).toEqual({ grade: 'F', degraded: true });

    const filepath = await writeRunReport('/tmp/newshound-run-report-test', {
      digestId: 'ai-tools',
      generatedAt: NOW,
      sourceReports: [
        { sourceName: 'Feed', fetched: 3, enriched: 2, deduped: 2, ranked: 1, status: 'ok' },
        { sourceName: 'YouTube', fetched: 0, enriched: 0, deduped: 0, ranked: 0, status: 'failed' },
      ],
    });

    expect(filepath).toContain('ai-tools');
  });
});
