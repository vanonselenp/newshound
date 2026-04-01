import { readFile, readdir } from 'fs/promises';
import { homedir } from 'os';
import { basename, join } from 'path';
import { parse } from 'yaml';
import type { Config, DigestConfig, DigestFileConfig } from './config';

export const CONFIG_DIR = join(homedir(), '.newshound');

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

export async function loadConfig(configDir: string = CONFIG_DIR): Promise<Config> {
  const baseConfigPath = join(configDir, 'config.yaml');
  const base = await parseYaml<{ vaultPath: string }>(baseConfigPath);

  if (!base?.vaultPath) {
    throw new Error(`config.yaml must contain a vaultPath field`);
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

  const digests: DigestConfig[] = await Promise.all(
    yamlFiles.map(async (filename) => {
      const id = basename(filename, '.yaml');
      const filepath = join(digestsDir, filename);
      const fileConfig = await parseYaml<DigestFileConfig>(filepath);
      const stateFilePath = fileConfig.stateFilePath ?? join(configDir, 'state', `${id}.json`);
      return { ...fileConfig, id, stateFilePath };
    }),
  );

  return { vaultPath: base.vaultPath, digests };
}
