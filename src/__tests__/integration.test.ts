import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtemp, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';

// We test the pipeline by importing each module and wiring them together
// with mocked dependencies — no real network calls or Claude invocations.

import { readLastRun, writeLastRun } from '../state';
import { filterItems } from '../filter';
import { summariseItems } from '../summarise';
import { renderDigest, readRecentDigests, writeDigest } from '../vault';
import { fetchAllSources } from '../fetchers/orchestrator';
import type { FeedItem } from '../types';
import type { DigestConfig, FilterCriteria } from '../config';

function makeItem(title: string): FeedItem {
  return {
    title,
    url: `https://example.com/${title.toLowerCase().replace(/ /g, '-')}`,
    publishedAt: new Date('2026-03-30T08:00:00Z'),
    description: `Description for ${title}.`,
    sourceName: 'Test Source',
    tier: 'curated',
  };
}

const TEST_CRITERIA: FilterCriteria = {
  purpose: 'AI tooling and development',
  audience: 'a staff engineer who wants practical, actionable AI tooling updates',
  highSignal: ['New tool releases with concrete capabilities'],
  lowSignal: ['Hype and speculation'],
};

const TEST_DIGEST_CONFIG: DigestConfig = {
  id: 'ai-tools',
  name: 'AI Digest',
  outputDir: 'AI-Digest',
  stateFilePath: '~/.ai-digest-state.json',
  lookbackDays: 3,
  sources: [{ name: 'Test Feed', type: 'rss', url: 'https://example.com/rss', tier: 'curated' }],
  filterCriteria: TEST_CRITERIA,
  tags: ['tooling', 'models', 'workflows'],
};

const FILTER_RESPONSE = JSON.stringify([
  { index: 0, signal: 'high' },
  { index: 1, signal: 'worth_knowing' },
]);

const SUMMARISE_RESPONSE = JSON.stringify({
  readInFull: [{ title: 'Item One', url: 'https://example.com/item-one', source: 'Test Source', summary: 'Read this.', takeaway: '' }],
  highSignal: [{ title: 'Item One', url: 'https://example.com/item-one', source: 'Test Source', summary: 'Very useful feature.', takeaway: 'Use it now.' }],
  worthKnowing: [{ title: 'Item Two', url: 'https://example.com/item-two', source: 'Test Source', summary: 'Minor thing.' }],
  tags: ['tooling'],
  related: [],
});

describe('Integration: happy path', () => {
  let vaultPath: string;
  let stateFile: string;
  let callIndex: number;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'newshound-int-'));
    stateFile = join(vaultPath, 'state.json');
    callIndex = 0;
  });

  it('runs full pipeline: fetch → filter → summarise → write → update state', async () => {
    const now = new Date('2026-03-30T09:00:00Z');
    const since = new Date('2026-03-29T08:00:00Z');
    await writeLastRun(stateFile, since);

    const mockFeed = vi.fn().mockResolvedValue([makeItem('Item One'), makeItem('Item Two')]);
    const mockReddit = vi.fn().mockResolvedValue([]);
    const mockHN = vi.fn().mockResolvedValue([]);

    // Claude adapter returns filter response first call, summarise response second
    const mockClaude = vi.fn().mockImplementation(() => {
      callIndex++;
      return Promise.resolve(callIndex === 1 ? FILTER_RESPONSE : SUMMARISE_RESPONSE);
    });

    const { items, warnings } = await fetchAllSources(
      [
        { name: 'Test Feed', type: 'rss', url: 'https://example.com/rss', tier: 'curated' },
      ],
      since,
      { fetchFeed: mockFeed, fetchReddit: mockReddit, fetchHN: mockHN },
    );
    expect(warnings).toHaveLength(0);
    expect(items).toHaveLength(2);

    const filterResult = await filterItems(items, TEST_CRITERIA, mockClaude);
    expect(filterResult.highSignal).toHaveLength(1);
    expect(filterResult.worthKnowing).toHaveLength(1);

    const recentDigests = await readRecentDigests(vaultPath, 'AI-Digest', 14);
    expect(recentDigests).toHaveLength(0);

    const digestContent = await summariseItems(filterResult, items.length, recentDigests, TEST_DIGEST_CONFIG, mockClaude);
    expect(digestContent.highSignal).toHaveLength(1);
    expect(digestContent.tags).toContain('tooling');

    const markdown = renderDigest(digestContent, now, 'AI Digest', 'ai-tools');
    expect(markdown).toContain('# AI Digest — 2026-03-30');
    expect(markdown).toContain('sources_scanned: 2');

    const outputPath = await writeDigest(vaultPath, 'AI-Digest', now, markdown);
    expect(existsSync(outputPath)).toBe(true);
    const written = await readFile(outputPath, 'utf-8');
    expect(written).toContain('# AI Digest — 2026-03-30');

    await writeLastRun(stateFile, now);
    const updatedState = await readLastRun(stateFile, 3);
    expect(updatedState.toISOString()).toBe(now.toISOString());
  });
});

describe('Integration: catch-up scenario', () => {
  let vaultPath: string;
  let stateFile: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'newshound-int-'));
    stateFile = join(vaultPath, 'state.json');
  });

  it('renders period frontmatter when last run was 5+ days ago', async () => {
    const now = new Date('2026-03-30T09:00:00Z');
    const fiveDaysAgo = new Date('2026-03-25T08:00:00Z');
    await writeLastRun(stateFile, fiveDaysAgo);

    const since = await readLastRun(stateFile, 3);
    expect(since.toISOString()).toBe('2026-03-25T08:00:00.000Z');

    const isCatchUp = now.getTime() - since.getTime() > 26 * 60 * 60 * 1000;
    expect(isCatchUp).toBe(true);

    const digestContent = {
      readInFull: [],
      highSignal: [],
      worthKnowing: [],
      tags: [],
      related: [],
      sourcesSurveyed: 10,
      itemsFiltered: 10,
    };

    const catchUpSince = isCatchUp ? since : undefined;
    const markdown = renderDigest(digestContent, now, 'AI Digest', 'ai-tools', catchUpSince);

    expect(markdown).toContain('period: 2026-03-25 to 2026-03-30');
    expect(markdown).toContain('*Nothing cleared the signal threshold today.*');
  });
});
