import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawnSync: vi.fn() };
});

import { CliProcessService } from '../cli-process-service.js';

const tempDirs: string[] = [];
const originalPlatform = process.platform;

function encodeCwd(cwd: string): string {
  return cwd
    .split('')
    .map((char) => (/^[A-Za-z0-9.-]$/.test(char) ? char : `_${char.charCodeAt(0).toString(16).padStart(2, '0')}`))
    .join('');
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe('CliProcessService Windows termination races', () => {
  it('treats an ESRCH from the fallback runner kill as already terminated', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    vi.mocked(spawnSync).mockReturnValue({ status: 1 } as ReturnType<typeof spawnSync>);
    const root = mkdtempSync(join(tmpdir(), 'ai-cli-windows-kill-'));
    tempDirs.push(root);
    const stateDir = join(root, 'state');
    const workFolder = join(root, 'work');
    const pid = 987654;
    mkdirSync(workFolder, { recursive: true });
    const processDir = join(
      stateDir,
      'cwds',
      encodeCwd(realpathSync(workFolder)),
      String(pid),
    );
    mkdirSync(processDir, { recursive: true });
    writeFileSync(join(processDir, 'stdout.log'), '');
    writeFileSync(join(processDir, 'stderr.log'), '');
    writeFileSync(
      join(processDir, 'meta.json'),
      JSON.stringify({
        pid,
        prompt: 'termination race',
        workFolder,
        toolType: 'claude',
        startTime: new Date().toISOString(),
        stdoutPath: join(processDir, 'stdout.log'),
        stderrPath: join(processDir, 'stderr.log'),
        status: 'running',
      }),
    );
    const service = new CliProcessService({
      stateDir,
      cliPaths: {
        claude: process.execPath,
        codex: process.execPath,
        gemini: process.execPath,
        forge: process.execPath,
        opencode: process.execPath,
      },
    });
    let existenceChecks = 0;
    const killSpy = vi.spyOn(globalThis.process, 'kill').mockImplementation((target, signal) => {
      if (target === pid && signal === 0) {
        existenceChecks++;
        if (existenceChecks === 1) {
          return true;
        }
        throw Object.assign(new Error('already exited'), { code: 'ESRCH' });
      }
      if (target === pid && signal === 'SIGTERM') {
        throw Object.assign(new Error('already exited'), { code: 'ESRCH' });
      }
      return true;
    });

    await expect(service.killProcess(pid)).resolves.toEqual({
      pid,
      status: 'terminated',
      message: 'Process terminated successfully',
    });
    expect(spawnSync).toHaveBeenCalledWith(
      'taskkill.exe',
      ['/pid', String(pid), '/t', '/f'],
      { stdio: 'ignore', windowsHide: true },
    );
    expect(killSpy).toHaveBeenCalledWith(pid, 'SIGTERM');
  });
});
