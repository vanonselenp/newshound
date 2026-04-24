import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'stream';
import { createClaudeAdapter } from '../claude';

function makeMockProcess(exitCode: number, stdoutData: string, stderrData: string) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { on: (event: string, listener: (...args: unknown[]) => void) => void };
    stderr: EventEmitter & { on: (event: string, listener: (...args: unknown[]) => void) => void };
    stdin: { write: (data: string) => void; end: () => void };
  };

  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const stdin = { write: vi.fn(), end: vi.fn() };

  proc.stdout = stdout as typeof proc.stdout;
  proc.stderr = stderr as typeof proc.stderr;
  proc.stdin = stdin;

  // Simulate async process completion
  setTimeout(() => {
    if (stdoutData) stdout.emit('data', Buffer.from(stdoutData));
    if (stderrData) stderr.emit('data', Buffer.from(stderrData));
    proc.emit('close', exitCode);
  }, 0);

  return proc;
}

describe('createClaudeAdapter', () => {
  it('returns stdout on successful execution', async () => {
    const mockSpawn = vi.fn().mockReturnValue(
      makeMockProcess(0, '{"result": "ok"}', ''),
    );
    const adapter = createClaudeAdapter(mockSpawn as never);
    const result = await adapter('test prompt');
    expect(result).toBe('{"result": "ok"}');
  });

  it('passes prompt via stdin', async () => {
    const mockProc = makeMockProcess(0, 'response', '');
    const mockSpawn = vi.fn().mockReturnValue(mockProc);
    const writeSpy = vi.spyOn(mockProc.stdin, 'write');
    const adapter = createClaudeAdapter(mockSpawn as never);
    await adapter('my test prompt');
    expect(writeSpy).toHaveBeenCalledWith('my test prompt');
  });

  it('calls claude with --print - arguments', async () => {
    const mockSpawn = vi.fn().mockReturnValue(makeMockProcess(0, 'ok', ''));
    const adapter = createClaudeAdapter(mockSpawn as never);
    await adapter('prompt');
    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      ['--print', '-'],
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
    );
  });

  it('throws with stderr message on non-zero exit', async () => {
    const mockSpawn = vi.fn().mockReturnValue(
      makeMockProcess(1, '', 'rate limit exceeded'),
    );
    const adapter = createClaudeAdapter(mockSpawn as never);
    await expect(adapter('prompt')).rejects.toThrow('rate limit exceeded');
  });

  it('includes exit code in error message', async () => {
    const mockSpawn = vi.fn().mockReturnValue(
      makeMockProcess(2, '', 'error output'),
    );
    const adapter = createClaudeAdapter(mockSpawn as never);
    await expect(adapter('prompt')).rejects.toThrow('code 2');
  });

  it('rejects with timeout error when process hangs', async () => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { write: () => void; end: () => void };
      kill: () => void;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { write: vi.fn(), end: vi.fn() };
    proc.kill = vi.fn();
    // Never emits 'close' — simulates a hung process

    const mockSpawn = vi.fn().mockReturnValue(proc);
    const adapter = createClaudeAdapter(mockSpawn as never, 50);
    await expect(adapter('prompt')).rejects.toThrow('timed out after 50ms');
  });
});
