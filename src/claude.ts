import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

export type ClaudeAdapter = (prompt: string) => Promise<string>;

export function stripJsonFences(response: string): string {
  return response.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
}

type SpawnFn = (
  command: string,
  args: string[],
  options: { stdio: ['pipe', 'pipe', 'pipe'] },
) => ChildProcessWithoutNullStreams;

export function createClaudeAdapter(spawnFn: SpawnFn = spawn, timeoutMs = 300_000): ClaudeAdapter {
  return async (prompt: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const proc = spawnFn('claude', ['--print', '-'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`claude timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Failed to spawn claude: ${err.message}`));
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`claude exited with code ${code ?? 'null'}: ${stderr.trim()}`));
        } else {
          resolve(stdout);
        }
      });

      proc.stdin.write(prompt);
      proc.stdin.end();
    });
  };
}
