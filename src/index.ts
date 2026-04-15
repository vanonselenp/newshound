import { homedir } from 'os';
import { join } from 'path';
import { createClaudeAdapter } from './claude';
import { CONFIG_DIR, loadConfig } from './config-loader';
import { fetchAllSources } from './fetchers/orchestrator';
import { buildDigestRunOptions, dedupeCandidates, enrichCandidates, rankCandidates, writeRunReport } from './pipeline';
import { readLastRun, writeLastRun } from './state';
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
    process.stderr.write(`[newshound] ${err instanceof Error ? err.message : String(err)}\nCopy config.example/ to ${CONFIG_DIR} and fill in your vault path.\n`);
    process.exit(1);
  }

  const claude = createClaudeAdapter();

  for (const digest of config.digests) {
    const stateFilePath = digest.stateFilePath.replace(/^~/, homedir());
    const since = await readLastRun(stateFilePath, digest.lookbackDays);
    const now = new Date();
    const isCatchUp = now.getTime() - since.getTime() > 26 * 60 * 60 * 1000;
    const runOptions = buildDigestRunOptions(digest.candidateBudget);

    log(digest.id, `Fetching content since ${since.toISOString()}${isCatchUp ? ' (catch-up run)' : ''}...`);
    const fetched = await fetchAllSources(digest.sources, since);
    const rawCandidates = fetched.items.slice(0, runOptions.maxRawCandidatesPerRun);

    log(digest.id, `Fetched ${rawCandidates.length} candidates across ${digest.sources.length} sources.`);
    const enriched = await enrichCandidates(rawCandidates, runOptions);
    const deduped = dedupeCandidates(enriched);
    const ranked = await rankCandidates(deduped, runOptions, claude, now, digest.filterCriteria);

    const sourceHealthPercent = fetched.sourceReports.length === 0
      ? 100
      : Math.round((fetched.sourceReports.filter((report) => report.status === 'ok').length / fetched.sourceReports.length) * 100);

    const recentDigests = await readRecentDigests(config.vaultPath, digest.outputDir, 14);
    const digestContent = await summariseItems(ranked, rawCandidates.length, recentDigests, digest, claude, sourceHealthPercent);
    const markdown = renderDigest(digestContent, now, digest.name, digest.id, isCatchUp ? since : undefined);
    await writeDigest(config.vaultPath, digest.outputDir, now, markdown);

    const reportDir = join(config.vaultPath, digest.outputDir, 'reports');
    await writeRunReport(reportDir, {
      digestId: digest.id,
      generatedAt: now,
      sourceReports: fetched.sourceReports.map((report) => ({
        ...report,
        enriched: enriched.filter((candidate) => candidate.sourceName === report.sourceName && candidate.contentFetched).length,
        deduped: deduped.filter((candidate) => candidate.sourceName === report.sourceName || candidate.alternates?.some((alt) => alt.sourceName === report.sourceName)).length,
        ranked: ranked.filter((candidate) => candidate.sourceName === report.sourceName || candidate.alternates?.some((alt) => alt.sourceName === report.sourceName)).length,
      })),
    });

    await writeLastRun(stateFilePath, now);
    log(digest.id, 'Done.');
  }
}

main().catch((err) => {
  process.stderr.write(`[newshound] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
