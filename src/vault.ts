import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type { DigestContent } from './types';

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0] as string;
}

function digestDir(vaultPath: string, outputDir: string): string {
  return join(vaultPath, outputDir);
}

export async function readRecentDigests(vaultPath: string, outputDir: string, days: number): Promise<string[]> {
  const dir = digestDir(vaultPath, outputDir);
  if (!existsSync(dir)) return [];

  const now = Date.now();
  const reads = Array.from({ length: days }, (_, index) => {
    const date = new Date(now - (index + 1) * 24 * 60 * 60 * 1000);
    return readFile(join(dir, `${formatDate(date)}.md`), 'utf-8').catch(() => null);
  });

  const results = await Promise.all(reads);
  return results.filter((content): content is string => content !== null);
}

export function renderDigest(content: DigestContent, date: Date, digestName: string, rootTag: string, catchUpSince?: Date): string {
  const dateStr = formatDate(date);
  const itemsSurfaced = content.highSignal.length + content.worthKnowing.length;
  const sourceHealthPercent = content.sourceHealthPercent ?? 100;
  const runHealthGrade = content.runHealthGrade ?? 'A';
  const frontmatter = ['---', `date: ${dateStr}`];
  if (catchUpSince) frontmatter.push(`period: ${formatDate(catchUpSince)} to ${dateStr}`);
  frontmatter.push('tags:');
  for (const tag of [rootTag, ...content.tags]) frontmatter.push(`  - ${tag}`);
  frontmatter.push(`sources_scanned: ${content.sourcesSurveyed}`);
  frontmatter.push(`items_surfaced: ${itemsSurfaced}`);
  frontmatter.push(`items_filtered: ${content.itemsFiltered}`);
  frontmatter.push(`source_health: ${sourceHealthPercent}`);
  frontmatter.push(`run_health: ${runHealthGrade}`);
  if (content.related.length > 0) {
    frontmatter.push('related:');
    for (const related of content.related) frontmatter.push(`  - "${related}"`);
  }
  frontmatter.push('---');

  if (itemsSurfaced === 0) {
    return `${frontmatter.join('\n')}\n\n# ${digestName} — ${dateStr}\n\n*Nothing cleared the signal threshold today.*\n`;
  }

  const lines: string[] = [frontmatter.join('\n'), '', `# ${digestName} — ${dateStr}`];
  if (content.readInFull.length > 0) {
    lines.push('', '## Read in full', '');
    for (const item of content.readInFull) lines.push(`- [${item.title}](${item.url}) · ${item.source} — ${item.summary}`);
  }
  if (content.highSignal.length > 0) {
    lines.push('', '## High signal', '');
    for (const item of content.highSignal) {
      lines.push(`### [${item.title}](${item.url})`);
      lines.push(`*${item.source}*`, '', item.summary);
      if (item.takeaway) lines.push('', `**Takeaway:** ${item.takeaway}`);
      lines.push('');
    }
  }
  if (content.worthKnowing.length > 0) {
    lines.push('## Worth knowing', '');
    for (const item of content.worthKnowing) lines.push(`- [${item.title}](${item.url}) · ${item.source} — ${item.summary}`);
    lines.push('');
  }
  lines.push('---', '', `*${content.itemsFiltered} items filtered as low-signal.*`, '');
  return lines.join('\n');
}

export async function writeDigest(vaultPath: string, outputDir: string, date: Date, content: string): Promise<string> {
  const dir = digestDir(vaultPath, outputDir);
  await mkdir(dir, { recursive: true });
  const filepath = join(dir, `${formatDate(date)}.md`);
  await writeFile(filepath, content, 'utf-8');
  return filepath;
}
