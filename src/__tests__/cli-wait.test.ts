import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliProcessService } from '../cli-process-service.js';

let root: string;
let processDir: string;
let service: CliProcessService;
const pid = process.pid;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ai-cli-wait-'));
  processDir = join(root, 'cwds', 'test', String(pid));
  mkdirSync(processDir, { recursive: true });
  const stdoutPath = join(processDir, 'stdout.log');
  const stderrPath = join(processDir, 'stderr.log');
  writeFileSync(stdoutPath, '');
  writeFileSync(stderrPath, '');
  // Use this live process's PID; the wait operation only probes it, never signals it.
  writeFileSync(join(processDir, 'meta.json'), JSON.stringify({
    pid, cwdKey: 'test', workFolder: root, prompt: 'test', model: 'codex',
    toolType: 'codex', status: 'running', startTime: new Date().toISOString(), stdoutPath, stderrPath,
  }));
  service = new CliProcessService({
    stateDir: root,
    cliPaths: { claude: process.execPath, codex: process.execPath, gemini: process.execPath, forge: process.execPath, opencode: process.execPath, grok: process.execPath },
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});

describe('CLI wait deadlines', () => {
  it('keeps polling beyond the default deadline with timeout zero and returns on completion', async () => {
    let settled = false;
    const outcome = service.waitForProcesses([pid], 0).then(
      (results) => { settled = true; return { results }; },
      (error) => { settled = true; return { error }; },
    );

    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(50);
    expect(settled).toBe(false);

    writeFileSync(join(processDir, 'exit-status.json'), JSON.stringify({ status: 'completed', exitCode: 0 }));
    await vi.advanceTimersByTimeAsync(50);
    expect(await outcome).toMatchObject({ results: [{ pid, status: 'completed', exitCode: 0 }] });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([undefined, 0.1])('retains the deadline for timeout %s without stopping the process', async (timeout) => {
    let settled = false;
    const outcome = service.waitForProcesses([pid], timeout).then(
      (results) => { settled = true; return { results }; },
      (error) => { settled = true; return { error }; },
    );

    vi.setSystemTime(Date.now() + (timeout ?? 180) * 1000 - 50);
    await vi.advanceTimersByTimeAsync(49);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toMatchObject({ error: new Error(`Timed out after ${timeout ?? 180} seconds waiting for processes`) });
    expect(JSON.parse(readFileSync(join(processDir, 'meta.json'), 'utf8')).status).toBe('running');
    expect(vi.getTimerCount()).toBe(0);
  });
});
