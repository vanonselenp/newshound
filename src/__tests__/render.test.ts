import { describe, it, expect } from 'vitest';
import { renderDigest } from '../vault';
import type { DigestContent } from '../types';

const FULL_CONTENT: DigestContent = {
  readInFull: [
    { title: 'Deep Dive into Claude Code', url: 'https://example.com/deep-dive', source: 'Anthropic', summary: 'Technical walkthrough you need to read.', takeaway: '' },
  ],
  highSignal: [
    {
      title: 'Claude Code gets agentic mode',
      url: 'https://example.com/claude-agentic',
      source: 'Anthropic Blog',
      summary: 'Claude Code now supports fully autonomous agentic workflows. This enables multi-step coding tasks without manual intervention.',
      takeaway: 'Try it on a refactoring task this week.',
    },
  ],
  worthKnowing: [
    { title: 'Cursor minor update', url: 'https://example.com/cursor', source: 'Cursor Changelog', summary: 'Small bug fix in tab completion.' },
  ],
  tags: ['tooling', 'coding-agents'],
  related: ['[[2026-03-27]]'],
  sourcesSurveyed: 47,
  itemsFiltered: 41,
};

const EMPTY_CONTENT: DigestContent = {
  readInFull: [],
  highSignal: [],
  worthKnowing: [],
  tags: [],
  related: [],
  sourcesSurveyed: 34,
  itemsFiltered: 34,
};

describe('renderDigest', () => {
  it('renders frontmatter with correct fields', () => {
    const date = new Date('2026-03-30T08:00:00Z');
    const output = renderDigest(FULL_CONTENT, date, 'AI Digest', 'ai-digest');

    expect(output).toContain('date: 2026-03-30');
    expect(output).toContain('- ai-digest');
    expect(output).toContain('- tooling');
    expect(output).toContain('- coding-agents');
    expect(output).toContain('sources_scanned: 47');
    expect(output).toContain('items_surfaced: 2');
    expect(output).toContain('items_filtered: 41');
    expect(output).toContain('- "[[2026-03-27]]"');
  });

  it('renders period in frontmatter for catch-up runs', () => {
    const date = new Date('2026-03-30T08:00:00Z');
    const since = new Date('2026-03-27T08:00:00Z');
    const output = renderDigest(FULL_CONTENT, date, 'AI Digest', 'ai-digest', since);

    expect(output).toContain('period: 2026-03-27 to 2026-03-30');
  });

  it('omits period field for regular runs', () => {
    const date = new Date('2026-03-30T08:00:00Z');
    const output = renderDigest(FULL_CONTENT, date, 'AI Digest', 'ai-digest');
    expect(output).not.toContain('period:');
  });

  it('omits related field when empty', () => {
    const content = { ...FULL_CONTENT, related: [] };
    const output = renderDigest(content, new Date('2026-03-30T08:00:00Z'), 'AI Digest', 'ai-digest');
    expect(output).not.toContain('related:');
  });

  it('renders correct body sections', () => {
    const output = renderDigest(FULL_CONTENT, new Date('2026-03-30T08:00:00Z'), 'AI Digest', 'ai-digest');
    expect(output).toContain('## Read in full');
    expect(output).toContain('## High signal');
    expect(output).toContain('## Worth knowing');
    expect(output).toContain('[Deep Dive into Claude Code](https://example.com/deep-dive)');
    expect(output).toContain('[Claude Code gets agentic mode](https://example.com/claude-agentic)');
    expect(output).toContain('Try it on a refactoring task this week.');
    expect(output).toContain('[Cursor minor update](https://example.com/cursor)');
  });

  it('renders filtered count in footer', () => {
    const output = renderDigest(FULL_CONTENT, new Date('2026-03-30T08:00:00Z'), 'AI Digest', 'ai-digest');
    expect(output).toContain('*41 items filtered as low-signal.*');
  });

  it('renders quiet-day stub when items_surfaced is 0', () => {
    const output = renderDigest(EMPTY_CONTENT, new Date('2026-03-30T08:00:00Z'), 'AI Digest', 'ai-digest');
    expect(output).toContain('*Nothing cleared the signal threshold today.*');
    expect(output).toContain('sources_scanned: 34');
    expect(output).toContain('items_surfaced: 0');
    expect(output).not.toContain('## High signal');
  });

  it('renders heading with digestName', () => {
    const output = renderDigest(FULL_CONTENT, new Date('2026-03-30T08:00:00Z'), 'AI Digest', 'ai-digest');
    expect(output).toContain('# AI Digest — 2026-03-30');
  });

  it('renders heading with custom digestName', () => {
    const output = renderDigest(FULL_CONTENT, new Date('2026-03-30T08:00:00Z'), 'Job Digest', 'jobs');
    expect(output).toContain('# Job Digest — 2026-03-30');
    expect(output).toContain('- jobs');
  });

  it('includes takeaway with bold Takeaway label', () => {
    const output = renderDigest(FULL_CONTENT, new Date('2026-03-30T08:00:00Z'), 'AI Digest', 'ai-digest');
    expect(output).toContain('**Takeaway:** Try it on a refactoring task this week.');
  });
});
