import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'fs/promises';
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

  it('loads the example AI tools digest with the revised tooling-focused source mix', async () => {
    const dir = await makeConfigDir();
    const exampleDigest = await readFile(
      join(__dirname, '..', '..', 'config.example', 'digests', 'ai-tools.yaml'),
      'utf-8',
    );
    await writeFile(join(dir, 'digests', 'ai-tools.yaml'), exampleDigest, 'utf-8');

    const config = await loadConfig(dir);
    expect(config.digests).toHaveLength(1);
    expect(config.digests[0]!.sources).toHaveLength(24);

    expect(config.digests[0]!.sources).toEqual(
      expect.arrayContaining([
        {
          name: 'Anthropic News',
          type: 'rss',
          url: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml',
          tier: 'curated',
        },
        {
          name: 'Anthropic Engineering',
          type: 'rss',
          url: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_engineering.xml',
          tier: 'curated',
        },
        {
          name: 'vLLM Blog',
          type: 'rss',
          url: 'https://blog.vllm.ai/rss.xml',
          tier: 'curated',
        },
        {
          name: 'Google DeepMind Blog',
          type: 'rss',
          url: 'https://deepmind.google/blog/rss.xml',
          tier: 'curated',
        },
        {
          name: 'GitHub Copilot Changelog',
          type: 'rss',
          url: 'https://github.blog/changelog/label/copilot/feed/',
          tier: 'curated',
        },
        {
          name: 'OpenRouter Changelog',
          type: 'rss',
          url: 'https://openrouter.ai/changelog/rss.xml',
          tier: 'curated',
        },
        {
          name: 'Ollama Blog',
          type: 'rss',
          url: 'https://ollama.com/blog/rss.xml',
          tier: 'curated',
        },
        {
          name: 'LangChain Blog',
          type: 'rss',
          url: 'https://blog.langchain.com/rss/',
          tier: 'curated',
        },
        {
          name: 'Together AI Blog',
          type: 'rss',
          url: 'https://www.together.ai/blog/rss.xml',
          tier: 'curated',
        },
      ]),
    );

    const sourceNames = config.digests[0]!.sources.map((source) => source.name);
    expect(sourceNames).not.toContain('Vercel Blog');
    expect(sourceNames).not.toContain('GitHub Blog');
    expect(sourceNames).not.toContain('Cloudflare Blog');
    expect(sourceNames).not.toContain('r/ChatGPT');
  });
});
