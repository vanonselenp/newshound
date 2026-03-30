import { readFile, writeFile } from 'fs/promises';

export async function readLastRun(stateFilePath: string, lookbackDays: number): Promise<Date> {
  try {
    const content = await readFile(stateFilePath, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`State file at ${stateFilePath} contains invalid JSON`);
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('lastRun' in parsed) ||
      typeof (parsed as Record<string, unknown>)['lastRun'] !== 'string'
    ) {
      throw new Error(`State file at ${stateFilePath} is missing required "lastRun" string field`);
    }
    const lastRun = new Date((parsed as { lastRun: string }).lastRun);
    if (isNaN(lastRun.getTime())) {
      throw new Error(
        `State file at ${stateFilePath} has invalid date: ${(parsed as { lastRun: string }).lastRun}`,
      );
    }
    return lastRun;
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      const defaultDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
      await writeFile(stateFilePath, JSON.stringify({ lastRun: defaultDate.toISOString() }), 'utf-8');
      return defaultDate;
    }
    throw err;
  }
}

export async function writeLastRun(stateFilePath: string, date: Date): Promise<void> {
  await writeFile(stateFilePath, JSON.stringify({ lastRun: date.toISOString() }), 'utf-8');
}
