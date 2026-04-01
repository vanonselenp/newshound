import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadConfig } from '../config-loader';

async function makeConfigDir(vaultPath = '/vault'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'newshound-config-'));
  await writeFile(join(dir, 'config.yaml'), `vaultPath: ${vaultPath}\n`, 'utf-8');
  await mkdir(join(dir, 'digests'), { recursive: true });
  return dir;
}

const MINIMAL_DIGEST = `
name: Test Digest
outputDir: Test-Digest
lookbackDays: 3
sources: []
filterCriteria:
  purpose: testing
  highSignal: []
  lowSignal: []
tags: []
`.trim();

describe('loadConfig', () => {
  it('loads vaultPath from config.yaml', async () => {
    const dir = await makeConfigDir('/my/vault');
    await writeFile(join(dir, 'digests', 'test.yaml'), MINIMAL_DIGEST, 'utf-8');

    const config = await loadConfig(dir);
    expect(config.vaultPath).toBe('/my/vault');
  });

  it('derives digest id from filename', async () => {
    const dir = await makeConfigDir();
    await writeFile(join(dir, 'digests', 'ai-tools.yaml'), MINIMAL_DIGEST, 'utf-8');

    const config = await loadConfig(dir);
    expect(config.digests).toHaveLength(1);
    expect(config.digests[0]!.id).toBe('ai-tools');
  });

  it('defaults stateFilePath to <configDir>/state/<id>.json', async () => {
    const dir = await makeConfigDir();
    await writeFile(join(dir, 'digests', 'ai-tools.yaml'), MINIMAL_DIGEST, 'utf-8');

    const config = await loadConfig(dir);
    expect(config.digests[0]!.stateFilePath).toBe(join(dir, 'state', 'ai-tools.json'));
  });

  it('respects explicit stateFilePath in YAML', async () => {
    const dir = await makeConfigDir();
    const digestYaml = MINIMAL_DIGEST + '\nstateFilePath: /custom/state.json';
    await writeFile(join(dir, 'digests', 'test.yaml'), digestYaml, 'utf-8');

    const config = await loadConfig(dir);
    expect(config.digests[0]!.stateFilePath).toBe('/custom/state.json');
  });

  it('loads multiple digests sorted alphabetically', async () => {
    const dir = await makeConfigDir();
    await writeFile(join(dir, 'digests', 'jobs.yaml'), MINIMAL_DIGEST, 'utf-8');
    await writeFile(join(dir, 'digests', 'ai-tools.yaml'), MINIMAL_DIGEST, 'utf-8');

    const config = await loadConfig(dir);
    expect(config.digests).toHaveLength(2);
    expect(config.digests[0]!.id).toBe('ai-tools');
    expect(config.digests[1]!.id).toBe('jobs');
  });

  it('throws when config.yaml is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'newshound-config-'));
    await expect(loadConfig(dir)).rejects.toThrow('Config file not found');
  });

  it('throws when config.yaml has no vaultPath', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'newshound-config-'));
    await writeFile(join(dir, 'config.yaml'), 'someOtherKey: value\n', 'utf-8');
    await mkdir(join(dir, 'digests'), { recursive: true });
    await writeFile(join(dir, 'digests', 'test.yaml'), MINIMAL_DIGEST, 'utf-8');

    await expect(loadConfig(dir)).rejects.toThrow('vaultPath');
  });

  it('throws when digests directory is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'newshound-config-'));
    await writeFile(join(dir, 'config.yaml'), 'vaultPath: /vault\n', 'utf-8');

    await expect(loadConfig(dir)).rejects.toThrow('Digests directory not found');
  });

  it('throws when digests directory is empty', async () => {
    const dir = await makeConfigDir();
    await expect(loadConfig(dir)).rejects.toThrow('No digest YAML files found');
  });

  it('throws with filename on invalid YAML', async () => {
    const dir = await makeConfigDir();
    await writeFile(join(dir, 'digests', 'bad.yaml'), ': invalid: yaml: {', 'utf-8');

    await expect(loadConfig(dir)).rejects.toThrow('bad.yaml');
  });
});
