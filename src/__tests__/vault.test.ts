import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { readRecentDigests, writeDigest } from '../vault';

describe('readRecentDigests', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'newshound-vault-'));
  });

  it('returns empty array when vault directory does not exist', async () => {
    const result = await readRecentDigests('/nonexistent/path/vault', 'AI-Digest', 7);
    expect(result).toEqual([]);
  });

  it('returns empty array when output folder does not exist', async () => {
    const result = await readRecentDigests(vaultPath, 'AI-Digest', 7);
    expect(result).toEqual([]);
  });

  it('returns empty array when no digest files are in range', async () => {
    const digestDir = join(vaultPath, 'AI-Digest');
    await mkdir(digestDir, { recursive: true });
    // Write a file outside the date range (very old)
    await writeFile(join(digestDir, '2020-01-01.md'), '# Old digest', 'utf-8');

    const result = await readRecentDigests(vaultPath, 'AI-Digest', 7);
    expect(result).toEqual([]);
  });

  it('returns contents of digest files within range', async () => {
    const digestDir = join(vaultPath, 'AI-Digest');
    await mkdir(digestDir, { recursive: true });

    // Write files for today and yesterday
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

    const todayStr = today.toISOString().split('T')[0]!;
    const yesterdayStr = yesterday.toISOString().split('T')[0]!;

    await writeFile(join(digestDir, `${todayStr}.md`), '# Today digest', 'utf-8');
    await writeFile(join(digestDir, `${yesterdayStr}.md`), '# Yesterday digest', 'utf-8');

    const result = await readRecentDigests(vaultPath, 'AI-Digest', 7);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some((r) => r.includes('Yesterday digest'))).toBe(true);
  });

  it('returns multiple files when they exist', async () => {
    const digestDir = join(vaultPath, 'AI-Digest');
    await mkdir(digestDir, { recursive: true });

    for (let i = 1; i <= 3; i++) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0]!;
      await writeFile(join(digestDir, `${dateStr}.md`), `# Digest ${i}`, 'utf-8');
    }

    const result = await readRecentDigests(vaultPath, 'AI-Digest', 7);
    expect(result).toHaveLength(3);
  });

  it('uses the provided outputDir to look up files', async () => {
    const customDir = join(vaultPath, 'Job-Digest');
    await mkdir(customDir, { recursive: true });

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dateStr = yesterday.toISOString().split('T')[0]!;
    await writeFile(join(customDir, `${dateStr}.md`), '# Job digest', 'utf-8');

    const result = await readRecentDigests(vaultPath, 'Job-Digest', 7);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('Job digest');
  });
});

describe('writeDigest', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'newshound-vault-'));
  });

  it('writes digest to correct path', async () => {
    const date = new Date('2026-03-30T08:00:00Z');
    const outputPath = await writeDigest(vaultPath, 'AI-Digest', date, '# Test digest content');
    expect(outputPath).toContain('AI-Digest');
    expect(outputPath).toContain('2026-03-30.md');
    const content = await readFile(outputPath, 'utf-8');
    expect(content).toBe('# Test digest content');
  });

  it('creates output directory if it does not exist', async () => {
    const date = new Date('2026-03-30T08:00:00Z');
    const outputPath = await writeDigest(vaultPath, 'AI-Digest', date, '# Content');
    expect(outputPath).toContain(join(vaultPath, 'AI-Digest'));
  });

  it('returns the full absolute path written', async () => {
    const date = new Date('2026-03-30T08:00:00Z');
    const outputPath = await writeDigest(vaultPath, 'AI-Digest', date, '# Content');
    const expectedPath = join(vaultPath, 'AI-Digest', '2026-03-30.md');
    expect(outputPath).toBe(expectedPath);
  });

  it('writes to custom outputDir', async () => {
    const date = new Date('2026-03-30T08:00:00Z');
    const outputPath = await writeDigest(vaultPath, 'Job-Digest', date, '# Job content');
    const expectedPath = join(vaultPath, 'Job-Digest', '2026-03-30.md');
    expect(outputPath).toBe(expectedPath);
    const content = await readFile(outputPath, 'utf-8');
    expect(content).toBe('# Job content');
  });
});
