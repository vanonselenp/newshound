import { homedir } from 'os';
import { loadConfig, CONFIG_DIR } from './config-loader';
import { createClaudeAdapter } from './claude';
import { readLastRun, writeLastRun } from './state';
import { fetchAllSources } from './fetchers/orchestrator';
import { filterItems } from './filter';
import { summariseItems } from './summarise';
import { readRecentDigests, renderDigest, writeDigest } from './vault';

function log(digestId: string, msg: string): void {
  process.stderr.write(`[newshound:${digestId}] ${msg}\n`);
}

async function main(): Promise<void> {
  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    process.stderr.write(
      `[newshound] ${err instanceof Error ? err.message : String(err)}\n` +
        `Copy config.example/ to ${CONFIG_DIR} and fill in your vault path.\n`,
    );
    process.exit(1);
  }

  const claude = createClaudeAdapter();

  for (const digest of config.digests) {
    const stateFilePath = digest.stateFilePath.replace(/^~/, homedir());
    const lookbackDays = digest.lookbackDays;

    log(digest.id, 'Reading last run timestamp…');
    const since = await readLastRun(stateFilePath, lookbackDays);
    const now = new Date();
    const isCatchUp = now.getTime() - since.getTime() > 26 * 60 * 60 * 1000;
    log(digest.id, `Fetching content since ${since.toISOString()}${isCatchUp ? ' (catch-up run)' : ''}…`);

    log(digest.id, 'Fetching sources…');
    const { items, warnings } = await fetchAllSources(digest.sources, since);
    for (const w of warnings) {
      log(digest.id, `WARNING: ${w}`);
    }
    log(digest.id, `Fetched ${items.length} items across ${digest.sources.length} sources.`);

    log(digest.id, 'Filtering for signal…');
    const filterResult = await filterItems(items, digest.filterCriteria, claude);
    log(
      digest.id,
      `Signal: ${filterResult.highSignal.length} high, ${filterResult.worthKnowing.length} worth knowing, ${filterResult.filtered.length} filtered.`,
    );

    log(digest.id, 'Reading recent digests for context…');
    const recentDigests = await readRecentDigests(config.vaultPath, digest.outputDir, 14);

    log(digest.id, 'Summarising…');
    const digestContent = await summariseItems(filterResult, items.length, recentDigests, digest, claude);

    const catchUpSince = isCatchUp ? since : undefined;
    const markdown = renderDigest(digestContent, now, digest.name, digest.id, catchUpSince);

    log(digest.id, 'Writing digest…');
    const outputPath = await writeDigest(config.vaultPath, digest.outputDir, now, markdown);
    log(digest.id, `Digest written to ${outputPath}`);

    log(digest.id, 'Updating state…');
    await writeLastRun(stateFilePath, now);
    log(digest.id, 'Done.');
  }
}

main().catch((err) => {
  process.stderr.write(`[newshound] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
