import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, unlink, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { readLastRun, writeLastRun } from '../state';

describe('readLastRun', () => {
  let dir: string;
  let stateFile: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'newshound-test-'));
    stateFile = join(dir, 'state.json');
  });

  afterEach(async () => {
    try { await unlink(stateFile); } catch { /* ignore */ }
  });

  it('returns stored date when file exists and is valid', async () => {
    const ts = '2026-03-28T10:00:00.000Z';
    await writeFile(stateFile, JSON.stringify({ lastRun: ts }), 'utf-8');
    const result = await readLastRun(stateFile, 3);
    expect(result.toISOString()).toBe(ts);
  });

  it('returns lookback date when file does not exist', async () => {
    const before = Date.now();
    const result = await readLastRun(stateFile, 3);
    const after = Date.now();
    const expected = 3 * 24 * 60 * 60 * 1000;
    expect(before - result.getTime()).toBeGreaterThanOrEqual(expected - 100);
    expect(after - result.getTime()).toBeLessThanOrEqual(expected + 100);
  });

  it('respects lookbackDays parameter', async () => {
    const before = Date.now();
    const result = await readLastRun(stateFile, 7);
    const expected = 7 * 24 * 60 * 60 * 1000;
    expect(before - result.getTime()).toBeGreaterThanOrEqual(expected - 100);
  });

  it('throws descriptive error when file has invalid JSON', async () => {
    await writeFile(stateFile, 'not json at all', 'utf-8');
    await expect(readLastRun(stateFile, 3)).rejects.toThrow('invalid JSON');
  });

  it('throws descriptive error when file is missing lastRun field', async () => {
    await writeFile(stateFile, JSON.stringify({ foo: 'bar' }), 'utf-8');
    await expect(readLastRun(stateFile, 3)).rejects.toThrow('"lastRun"');
  });

  it('throws descriptive error when lastRun is not a valid date', async () => {
    await writeFile(stateFile, JSON.stringify({ lastRun: 'not-a-date' }), 'utf-8');
    await expect(readLastRun(stateFile, 3)).rejects.toThrow('invalid date');
  });
});

describe('writeLastRun', () => {
  let dir: string;
  let stateFile: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'newshound-test-'));
    stateFile = join(dir, 'state.json');
  });

  it('writes ISO timestamp to file', async () => {
    const date = new Date('2026-03-30T08:00:00.000Z');
    await writeLastRun(stateFile, date);
    const raw = await import('fs/promises').then((m) => m.readFile(stateFile, 'utf-8'));
    const parsed = JSON.parse(raw) as { lastRun: string };
    expect(parsed.lastRun).toBe('2026-03-30T08:00:00.000Z');
  });

  it('overwrites existing file', async () => {
    await writeFile(stateFile, JSON.stringify({ lastRun: '2020-01-01T00:00:00.000Z' }), 'utf-8');
    const date = new Date('2026-03-30T08:00:00.000Z');
    await writeLastRun(stateFile, date);
    const result = await readLastRun(stateFile, 3);
    expect(result.toISOString()).toBe('2026-03-30T08:00:00.000Z');
  });

  it('round-trips: write then read returns same date', async () => {
    const date = new Date('2026-03-29T12:34:56.789Z');
    await writeLastRun(stateFile, date);
    const result = await readLastRun(stateFile, 3);
    expect(result.toISOString()).toBe(date.toISOString());
  });
});
