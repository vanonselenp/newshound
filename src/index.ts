import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { DEFAULT_SOURCES, type Config } from './config';
import { createClaudeAdapter } from './claude';
import { readLastRun, writeLastRun } from './state';
import { fetchAllSources } from './fetchers/orchestrator';
import { filterItems } from './filter';
import { summariseItems } from './summarise';
import { readRecentDigests, renderDigest, writeDigest } from './vault';

function log(msg: string): void {
  process.stderr.write(`[newshound] ${msg}\n`);
}

async function loadConfig(): Promise<Config> {
  const configPath = join(homedir(), '.ai-digest-config.json');
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch {
    process.stderr.write(
      `[newshound] Config file not found at ${configPath}\n` +
        `Copy config.example.json to ${configPath} and fill in your vault path.\n`,
    );
    process.exit(1);
  }
  try {
    return JSON.parse(raw) as Config;
  } catch {
    process.stderr.write(`[newshound] Config file at ${configPath} contains invalid JSON\n`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const claude = createClaudeAdapter();

  // Resolve ~ in stateFilePath
  const stateFilePath = config.stateFilePath.replace(/^~/, homedir());
  const lookbackDays = config.lookbackDays ?? 3;

  log('Reading last run timestamp…');
  const since = await readLastRun(stateFilePath, lookbackDays);
  const now = new Date();
  const isCatchUp = now.getTime() - since.getTime() > 26 * 60 * 60 * 1000; // >26h means catch-up
  log(`Fetching content since ${since.toISOString()}${isCatchUp ? ' (catch-up run)' : ''}…`);

  log('Fetching sources…');
  const { items, warnings } = await fetchAllSources(DEFAULT_SOURCES, since);
  for (const w of warnings) {
    log(`WARNING: ${w}`);
  }
  log(`Fetched ${items.length} items across ${DEFAULT_SOURCES.length} sources.`);

  log('Filtering for signal…');
  const filterResult = await filterItems(items, claude);
  log(
    `Signal: ${filterResult.highSignal.length} high, ${filterResult.worthKnowing.length} worth knowing, ${filterResult.filtered.length} filtered.`,
  );

  log('Reading recent digests for context…');
  const recentDigests = await readRecentDigests(config.vaultPath, 14);

  log('Summarising…');
  const digestContent = await summariseItems(filterResult, items.length, recentDigests, claude);

  const catchUpSince = isCatchUp ? since : undefined;
  const markdown = renderDigest(digestContent, now, catchUpSince);

  log('Writing digest…');
  const outputPath = await writeDigest(config.vaultPath, now, markdown);
  log(`Digest written to ${outputPath}`);

  log('Updating state…');
  await writeLastRun(stateFilePath, now);
  log('Done.');
}

main().catch((err) => {
  process.stderr.write(`[newshound] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
