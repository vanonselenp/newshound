import { describe, it, expect, vi } from 'vitest';
import { filterItems } from '../filter';
import type { FeedItem } from '../types';
import type { FilterCriteria } from '../config';

function makeItem(title: string, tier: 'curated' | 'community' = 'curated'): FeedItem {
  return {
    title,
    url: `https://example.com/${title.toLowerCase().replace(/ /g, '-')}`,
    publishedAt: new Date('2026-03-30T08:00:00Z'),
    description: `Description for ${title}`,
    sourceName: tier === 'curated' ? 'Anthropic Blog' : 'Hacker News',
    tier,
  };
}

const CRITERIA: FilterCriteria = {
  purpose: 'AI tooling and development',
  audience: 'a staff engineer who wants practical, actionable AI tooling updates',
  highSignal: [
    'New tool releases, features, or APIs with concrete capabilities',
    '"I built X with Y" posts showing real workflows or architectures',
  ],
  worthKnowing: [
    'Minor updates or incremental improvements to tools',
  ],
  lowSignal: [
    'Hype, speculation about AGI timelines, or "AI will replace X" takes',
    'Fundraising announcements or company drama',
  ],
};

describe('filterItems', () => {
  it('returns empty results when items list is empty', async () => {
    const claude = vi.fn();
    const result = await filterItems([], CRITERIA, claude);
    expect(result.highSignal).toHaveLength(0);
    expect(result.worthKnowing).toHaveLength(0);
    expect(result.filtered).toHaveLength(0);
    expect(claude).not.toHaveBeenCalled();
  });

  it('correctly partitions items by signal value', async () => {
    const items = [
      makeItem('Claude Code Feature'),
      makeItem('HN Discussion', 'community'),
      makeItem('Old News'),
    ];
    const claude = vi.fn().mockResolvedValue(
      JSON.stringify([
        { index: 0, signal: 'high' },
        { index: 1, signal: 'worth_knowing' },
        { index: 2, signal: 'low' },
      ]),
    );

    const result = await filterItems(items, CRITERIA, claude);
    expect(result.highSignal).toHaveLength(1);
    expect(result.highSignal[0]!.title).toBe('Claude Code Feature');
    expect(result.worthKnowing).toHaveLength(1);
    expect(result.worthKnowing[0]!.title).toBe('HN Discussion');
    expect(result.filtered).toHaveLength(1);
    expect(result.filtered[0]!.title).toBe('Old News');
  });

  it('includes tier info in the prompt sent to Claude', async () => {
    const items = [makeItem('Curated Post', 'curated'), makeItem('Community Post', 'community')];
    const claude = vi.fn().mockResolvedValue(
      JSON.stringify([{ index: 0, signal: 'high' }, { index: 1, signal: 'low' }]),
    );

    await filterItems(items, CRITERIA, claude);
    const prompt = claude.mock.calls[0]?.[0] as string;
    expect(prompt).toContain('tier=curated');
    expect(prompt).toContain('tier=community');
    expect(prompt).toContain('two-pass');
  });

  it('includes criteria purpose in the prompt', async () => {
    const items = [makeItem('Test')];
    const claude = vi.fn().mockResolvedValue(JSON.stringify([{ index: 0, signal: 'low' }]));

    await filterItems(items, CRITERIA, claude);
    const prompt = claude.mock.calls[0]?.[0] as string;
    expect(prompt).toContain('AI tooling and development');
  });

  it('includes audience clause in the prompt opener when set', async () => {
    const items = [makeItem('Test')];
    const claude = vi.fn().mockResolvedValue(JSON.stringify([{ index: 0, signal: 'low' }]));

    await filterItems(items, CRITERIA, claude);
    const prompt = claude.mock.calls[0]?.[0] as string;
    expect(prompt).toContain('targeted at a staff engineer who wants practical, actionable AI tooling updates');
  });

  it('omits audience clause when audience is not set', async () => {
    const criteriaNoAudience: FilterCriteria = { ...CRITERIA, audience: undefined };
    const items = [makeItem('Test')];
    const claude = vi.fn().mockResolvedValue(JSON.stringify([{ index: 0, signal: 'low' }]));

    await filterItems(items, criteriaNoAudience, claude);
    const prompt = claude.mock.calls[0]?.[0] as string;
    expect(prompt).not.toContain('targeted at');
  });

  it('injects user profile when set', async () => {
    const criteriaWithProfile: FilterCriteria = {
      ...CRITERIA,
      profile: 'Senior TypeScript engineer, 10 years experience',
    };
    const items = [makeItem('Test')];
    const claude = vi.fn().mockResolvedValue(JSON.stringify([{ index: 0, signal: 'low' }]));

    await filterItems(items, criteriaWithProfile, claude);
    const prompt = claude.mock.calls[0]?.[0] as string;
    expect(prompt).toContain('USER PROFILE (filter for fit against this):');
    expect(prompt).toContain('Senior TypeScript engineer');
  });

  it('does not include profile section when profile is not set', async () => {
    const items = [makeItem('Test')];
    const claude = vi.fn().mockResolvedValue(JSON.stringify([{ index: 0, signal: 'low' }]));

    await filterItems(items, CRITERIA, claude);
    const prompt = claude.mock.calls[0]?.[0] as string;
    expect(prompt).not.toContain('USER PROFILE');
  });

  it('throws descriptive error when Claude returns invalid JSON', async () => {
    const items = [makeItem('Test')];
    const claude = vi.fn().mockResolvedValue('Sorry, I cannot help with that.');
    await expect(filterItems(items, CRITERIA, claude)).rejects.toThrow('Failed to parse Claude filter response');
  });

  it('throws when Claude returns non-array JSON', async () => {
    const items = [makeItem('Test')];
    const claude = vi.fn().mockResolvedValue(JSON.stringify({ error: 'bad' }));
    await expect(filterItems(items, CRITERIA, claude)).rejects.toThrow('not a JSON array');
  });

  it('handles markdown-fenced JSON response', async () => {
    const items = [makeItem('Test')];
    const claude = vi.fn().mockResolvedValue(
      '```json\n[{"index": 0, "signal": "high"}]\n```',
    );
    const result = await filterItems(items, CRITERIA, claude);
    expect(result.highSignal).toHaveLength(1);
  });
});
