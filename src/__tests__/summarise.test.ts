import { describe, it, expect, vi } from 'vitest';
import { summariseItems } from '../summarise';
import type { FilterResult, FeedItem } from '../types';

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

    const result = await summariseItems(filterResult, 10, [], claude);

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

    const result = await summariseItems(filterResult, 5, [], claude);

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

    await summariseItems(filterResult, 3, ['## Previous digest content'], claude);

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

    await expect(summariseItems(filterResult, 3, [], claude)).resolves.toBeDefined();
  });

  it('filters out tags not in the vocabulary', async () => {
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

    const result = await summariseItems(filterResult, 3, [], claude);
    expect(result.tags).toEqual(['tooling']);
  });

  it('throws descriptive error when Claude returns invalid JSON', async () => {
    const filterResult: FilterResult = {
      highSignal: [makeItem('Test Item')],
      worthKnowing: [],
      filtered: [],
    };
    const claude = vi.fn().mockResolvedValue('Here is a summary: ...');
    await expect(summariseItems(filterResult, 3, [], claude)).rejects.toThrow(
      'Failed to parse Claude summarise response',
    );
  });
});
