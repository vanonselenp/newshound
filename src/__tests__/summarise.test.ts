import { describe, it, expect, vi } from 'vitest';
import { summariseItems } from '../summarise';
import type { FilterResult, FeedItem } from '../types';
import type { DigestConfig } from '../config';

function makeItem(title: string): FeedItem {
  return {
    title,
    url: `https://example.com/${title.toLowerCase().replace(/ /g, '-')}`,
    publishedAt: new Date('2026-03-30T08:00:00Z'),
    description: `Description for ${title}. More context here.`,
    sourceName: 'Test Source',
    tier: 'curated',
  };
}

const DIGEST_CONFIG: DigestConfig = {
  id: 'ai-tools',
  name: 'AI Digest',
  outputDir: 'AI-Digest',
  stateFilePath: '~/.ai-digest-state.json',
  lookbackDays: 3,
  sources: [],
  filterCriteria: {
    purpose: 'AI tooling and development',
    audience: 'a staff engineer who wants practical, actionable AI tooling updates',
    highSignal: ['New tool releases with concrete capabilities'],
    lowSignal: ['Hype and speculation'],
  },
  tags: ['tooling', 'models', 'workflows', 'pricing', 'apis', 'coding-agents', 'prompting', 'infrastructure', 'open-source', 'releases', 'ai-methodology', 'team-practices'],
};

const MOCK_DIGEST_RESPONSE = JSON.stringify({
  readInFull: [
    { title: 'Claude Feature', url: 'https://example.com/claude', source: 'Anthropic', summary: 'In-depth technical guide', takeaway: '' },
  ],
  highSignal: [
    { title: 'Claude Feature', url: 'https://example.com/claude', source: 'Anthropic', summary: 'Claude gets new coding feature. Very practical.', takeaway: 'Try it in your workflow.' },
  ],
  worthKnowing: [
    { title: 'Minor Update', url: 'https://example.com/minor', source: 'OpenAI', summary: 'Small incremental update.' },
  ],
  tags: ['tooling', 'coding-agents'],
  related: ['[[2026-03-27]]'],
});

describe('summariseItems', () => {
  it('maps Claude response to DigestContent correctly', async () => {
    const filterResult: FilterResult = {
      highSignal: [makeItem('Claude Feature')],
      worthKnowing: [makeItem('Minor Update')],
      filtered: [makeItem('Low Signal')],
    };
    const claude = vi.fn().mockResolvedValue(MOCK_DIGEST_RESPONSE);

    const result = await summariseItems(filterResult, 10, [], DIGEST_CONFIG, claude);

    expect(result.readInFull).toHaveLength(1);
    expect(result.highSignal).toHaveLength(1);
    expect(result.worthKnowing).toHaveLength(1);
    expect(result.tags).toContain('tooling');
    expect(result.tags).toContain('coding-agents');
    expect(result.related).toContain('[[2026-03-27]]');
    expect(result.sourcesSurveyed).toBe(10);
    expect(result.itemsFiltered).toBe(1);
  });

  it('returns empty DigestContent when no items survive filter', async () => {
    const filterResult: FilterResult = {
      highSignal: [],
      worthKnowing: [],
      filtered: [makeItem('Low Signal 1'), makeItem('Low Signal 2')],
    };
    const claude = vi.fn();

    const result = await summariseItems(filterResult, 5, [], DIGEST_CONFIG, claude);

    expect(result.highSignal).toHaveLength(0);
    expect(result.worthKnowing).toHaveLength(0);
    expect(result.tags).toHaveLength(0);
    expect(result.itemsFiltered).toBe(2);
    expect(claude).not.toHaveBeenCalled();
  });

  it('includes recentDigests in the prompt', async () => {
    const filterResult: FilterResult = {
      highSignal: [makeItem('Test Item')],
      worthKnowing: [],
      filtered: [],
    };
    const claude = vi.fn().mockResolvedValue(JSON.stringify({
      readInFull: [], highSignal: [], worthKnowing: [], tags: [], related: [],
    }));

    await summariseItems(filterResult, 3, ['## Previous digest content'], DIGEST_CONFIG, claude);

    const prompt = claude.mock.calls[0]?.[0] as string;
    expect(prompt).toContain('Previous digest content');
  });

  it('works when recentDigests is empty', async () => {
    const filterResult: FilterResult = {
      highSignal: [makeItem('Test Item')],
      worthKnowing: [],
      filtered: [],
    };
    const claude = vi.fn().mockResolvedValue(JSON.stringify({
      readInFull: [], highSignal: [], worthKnowing: [], tags: [], related: [],
    }));

    await expect(summariseItems(filterResult, 3, [], DIGEST_CONFIG, claude)).resolves.toBeDefined();
  });

  it('filters out tags not in the digest tag vocabulary', async () => {
    const filterResult: FilterResult = {
      highSignal: [makeItem('Test Item')],
      worthKnowing: [],
      filtered: [],
    };
    const claude = vi.fn().mockResolvedValue(JSON.stringify({
      readInFull: [],
      highSignal: [],
      worthKnowing: [],
      tags: ['tooling', 'made-up-tag', 'another-invented-tag'],
      related: [],
    }));

    const result = await summariseItems(filterResult, 3, [], DIGEST_CONFIG, claude);
    expect(result.tags).toEqual(['tooling']);
  });

  it('uses digestConfig.name in the prompt opener', async () => {
    const filterResult: FilterResult = {
      highSignal: [makeItem('Test Item')],
      worthKnowing: [],
      filtered: [],
    };
    const claude = vi.fn().mockResolvedValue(JSON.stringify({
      readInFull: [], highSignal: [], worthKnowing: [], tags: [], related: [],
    }));

    await summariseItems(filterResult, 3, [], DIGEST_CONFIG, claude);
    const prompt = claude.mock.calls[0]?.[0] as string;
    expect(prompt).toContain('You are writing a daily AI Digest');
  });

  it('injects summarisationContext when present', async () => {
    const configWithContext: DigestConfig = {
      ...DIGEST_CONFIG,
      summarisationContext: 'Focus on TypeScript and AWS content.',
    };
    const filterResult: FilterResult = {
      highSignal: [makeItem('Test Item')],
      worthKnowing: [],
      filtered: [],
    };
    const claude = vi.fn().mockResolvedValue(JSON.stringify({
      readInFull: [], highSignal: [], worthKnowing: [], tags: [], related: [],
    }));

    await summariseItems(filterResult, 3, [], configWithContext, claude);
    const prompt = claude.mock.calls[0]?.[0] as string;
    expect(prompt).toContain('Focus on TypeScript and AWS content.');
  });

  it('throws descriptive error when Claude returns invalid JSON', async () => {
    const filterResult: FilterResult = {
      highSignal: [makeItem('Test Item')],
      worthKnowing: [],
      filtered: [],
    };
    const claude = vi.fn().mockResolvedValue('Here is a summary: ...');
    await expect(summariseItems(filterResult, 3, [], DIGEST_CONFIG, claude)).rejects.toThrow(
      'Failed to parse Claude summarise response',
    );
  });

  it('retries once with a JSON repair prompt when Claude returns markdown digest output', async () => {
    const filterResult: FilterResult = {
      highSignal: [makeItem('Test Item')],
      worthKnowing: [],
      filtered: [],
    };
    const markdownDigest = ['```markdown', '---', 'date: 2026-04-17', 'tags:', '  - tooling', '---', '# AI Digest', '```'].join('\n');
    const claude = vi
      .fn()
      .mockResolvedValueOnce(markdownDigest)
      .mockResolvedValueOnce(
        JSON.stringify({
          readInFull: [],
          highSignal: [
            {
              title: 'Test Item',
              url: 'https://example.com/test-item',
              source: 'Test Source',
              summary: 'Useful summary.',
              takeaway: 'Try it.',
            },
          ],
          worthKnowing: [],
          tags: ['tooling'],
          related: [],
        }),
      );

    const result = await summariseItems(filterResult, 3, [], DIGEST_CONFIG, claude);

    expect(result.highSignal).toHaveLength(1);
    expect(result.tags).toEqual(['tooling']);
    expect(claude).toHaveBeenCalledTimes(2);
    expect((claude.mock.calls[1]?.[0] as string)).toContain('Your previous response was not valid JSON');
  });
});
