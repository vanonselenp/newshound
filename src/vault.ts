import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
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

  const results: string[] = [];
  const now = Date.now();

  for (let i = 1; i <= days; i++) {
    const date = new Date(now - i * 24 * 60 * 60 * 1000);
    const filename = `${formatDate(date)}.md`;
    const filepath = join(dir, filename);
    try {
      const content = await readFile(filepath, 'utf-8');
      results.push(content);
    } catch {
      // File doesn't exist for this date — skip
    }
  }

  return results;
}

export function renderDigest(
  content: DigestContent,
  date: Date,
  digestName: string,
  rootTag: string,
  catchUpSince?: Date,
): string {
  const dateStr = formatDate(date);
  const itemsSurfaced = content.highSignal.length + content.worthKnowing.length;
  const allTags = [rootTag, ...content.tags];

  const frontmatterLines: string[] = ['---', `date: ${dateStr}`];

  if (catchUpSince) {
    frontmatterLines.push(`period: ${formatDate(catchUpSince)} to ${dateStr}`);
  }

  frontmatterLines.push('tags:');
  for (const tag of allTags) {
    frontmatterLines.push(`  - ${tag}`);
  }

  frontmatterLines.push(`sources_scanned: ${content.sourcesSurveyed}`);
  frontmatterLines.push(`items_surfaced: ${itemsSurfaced}`);
  frontmatterLines.push(`items_filtered: ${content.itemsFiltered}`);

  if (content.related.length > 0) {
    frontmatterLines.push('related:');
    for (const rel of content.related) {
      frontmatterLines.push(`  - "${rel}"`);
    }
  }

  frontmatterLines.push('---');
  const frontmatter = frontmatterLines.join('\n');

  // Quiet day stub
  if (itemsSurfaced === 0) {
    return `${frontmatter}

# ${digestName} — ${dateStr}

*Nothing cleared the signal threshold today.*
`;
  }

  const lines: string[] = [frontmatter, '', `# ${digestName} — ${dateStr}`];

  // Read in full
  if (content.readInFull.length > 0) {
    lines.push('', '## Read in full', '');
    for (const item of content.readInFull) {
      lines.push(`- [${item.title}](${item.url}) · ${item.source} — ${item.summary}`);
    }
  }

  // High signal
  if (content.highSignal.length > 0) {
    lines.push('', '## High signal', '');
    for (const item of content.highSignal) {
      lines.push(`### [${item.title}](${item.url})`);
      lines.push(`*${item.source}*`);
      lines.push('');
      lines.push(item.summary);
      if (item.takeaway) {
        lines.push('');
        lines.push(`**Takeaway:** ${item.takeaway}`);
      }
      lines.push('');
    }
  }

  // Worth knowing
  if (content.worthKnowing.length > 0) {
    lines.push('## Worth knowing', '');
    for (const item of content.worthKnowing) {
      lines.push(`- [${item.title}](${item.url}) · ${item.source} — ${item.summary}`);
    }
    lines.push('');
  }

  lines.push('---', '');
  lines.push(`*${content.itemsFiltered} items filtered as low-signal.*`);
  lines.push('');

  return lines.join('\n');
}

export async function writeDigest(
  vaultPath: string,
  outputDir: string,
  date: Date,
  content: string,
): Promise<string> {
  const dir = digestDir(vaultPath, outputDir);
  await mkdir(dir, { recursive: true });
  const filename = `${formatDate(date)}.md`;
  const filepath = join(dir, filename);
  await writeFile(filepath, content, 'utf-8');
  return filepath;
}
