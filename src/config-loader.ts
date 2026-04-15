import { readFile, readdir } from 'fs/promises';
import { homedir } from 'os';
import { basename, join } from 'path';
import { parse } from 'yaml';
import type {
  CandidateBudget,
  Config,
  DigestConfig,
  DigestFileConfig,
  GitHubSource,
  HNSource,
  Source,
  YouTubeSource,
} from './config';

export const CONFIG_DIR = join(homedir(), '.newshound');

const DEFAULT_BUDGET: CandidateBudget = {
  maxRawCandidatesPerRun: 200,
  maxFullTextFetchesPerRun: 25,
  maxRankedCandidatesForClaude: 20,
};

const DEFAULT_HN_QUERY_TERMS = ['Claude', 'LLM', 'Cursor', 'Copilot', 'ChatGPT', 'Gemini', 'llama', 'AI coding'];

async function parseYaml<T>(filepath: string): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(filepath, 'utf-8');
  } catch {
    throw new Error(`Config file not found: ${filepath}`);
  }
  try {
    return parse(raw) as T;
  } catch (err) {
    throw new Error(`Invalid YAML in ${filepath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function applySourceDefaults(source: Source): Source {
  if (source.type === 'hn') {
    const hn = source as HNSource;
    return { ...hn, queryTerms: hn.queryTerms ?? DEFAULT_HN_QUERY_TERMS };
  }
  if (source.type === 'youtube') {
    const youtube = source as YouTubeSource;
    return { ...youtube, mode: youtube.mode ?? 'discovery' };
  }
  if (source.type === 'github') {
    const github = source as GitHubSource;
    return { ...github, mode: github.mode ?? 'discovery' };
  }
  return source;
}

function applyDigestDefaults(id: string, configDir: string, fileConfig: DigestFileConfig): DigestConfig {
  const stateFilePath = fileConfig.stateFilePath ?? join(configDir, 'state', `${id}.json`);
  return {
    ...fileConfig,
    id,
    stateFilePath,
    sources: fileConfig.sources.map((source) => applySourceDefaults(source)),
    candidateBudget: {
      maxRawCandidatesPerRun: fileConfig.candidateBudget?.maxRawCandidatesPerRun ?? DEFAULT_BUDGET.maxRawCandidatesPerRun,
      maxFullTextFetchesPerRun: fileConfig.candidateBudget?.maxFullTextFetchesPerRun ?? DEFAULT_BUDGET.maxFullTextFetchesPerRun,
      maxRankedCandidatesForClaude:
        fileConfig.candidateBudget?.maxRankedCandidatesForClaude ?? DEFAULT_BUDGET.maxRankedCandidatesForClaude,
    },
  };
}

export async function loadConfig(configDir: string = CONFIG_DIR): Promise<Config> {
  const baseConfigPath = join(configDir, 'config.yaml');
  const base = await parseYaml<{ vaultPath: string }>(baseConfigPath);

  if (!base?.vaultPath) {
    throw new Error('config.yaml must contain a vaultPath field');
  }

  const digestsDir = join(configDir, 'digests');
  let entries: string[];
  try {
    entries = await readdir(digestsDir);
  } catch {
    throw new Error(`Digests directory not found: ${digestsDir}\nCreate it and add at least one digest YAML file.`);
  }

  const yamlFiles = entries.filter((f) => f.endsWith('.yaml')).sort();
  if (yamlFiles.length === 0) {
    throw new Error(`No digest YAML files found in ${digestsDir}`);
  }

  const digests = await Promise.all(
    yamlFiles.map(async (filename) => {
      const id = basename(filename, '.yaml');
      const filepath = join(digestsDir, filename);
      const fileConfig = await parseYaml<DigestFileConfig>(filepath);
      return applyDigestDefaults(id, configDir, fileConfig);
    }),
  );

  return { vaultPath: base.vaultPath, digests };
}
