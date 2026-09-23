import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliProcessService } from '../cli-process-service.js';
import * as cliBuilder from '../cli-builder.js';

const tempDirs: string[] = [];

function encodeCwd(cwd: string): string {
  return cwd
    .split('')
    .map((char) => (/^[A-Za-z0-9.-]$/.test(char) ? char : `_${char.charCodeAt(0).toString(16).padStart(2, '0')}`))
    .join('');
}

function createServiceFixture(): {
  service: CliProcessService;
  stateDir: string;
  workFolder: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'ai-cli-node-service-'));
  tempDirs.push(root);
  const stateDir = join(root, 'state');
  const workFolder = join(root, 'work');
  mkdirSync(workFolder, { recursive: true });
  // Exercise the detached runner with a native executable independently of
  // provider-specific CLI flags, which Node.js does not accept.
  vi.spyOn(cliBuilder, 'buildCliCommand').mockImplementation(options => ({
    cliPath: process.execPath,
    args: ['-p', options.prompt!],
    cwd: workFolder,
    agent: 'claude',
    prompt: options.prompt!,
    resolvedModel: 'sonnet',
  }));
  return {
    service: new CliProcessService({
      stateDir,
      cliPaths: {
        claude: process.execPath,
        codex: process.execPath,
        gemini: process.execPath,
        opencode: process.execPath,
        grok: process.execPath,
      },
    }),
    stateDir,
    workFolder,
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true });
        lastError = undefined;
        break;
      } catch (error: any) {
        lastError = error;
        if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error.code)) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (lastError) {
      throw lastError;
    }
  }
});

describe('CliProcessService with the detached Node.js runner', () => {
  it.each([5, 0])('runs a native executable and persists output with wait timeout %s', async (timeout) => {
    const { service, stateDir, workFolder } = createServiceFixture();
    const started = await service.startProcess({
      cwd: workFolder,
      model: 'sonnet',
      prompt: '40 + 2',
    });

    const [result] = await service.waitForProcesses([started.pid], timeout);
    const processDir = join(
      stateDir,
      'cwds',
      encodeCwd(realpathSync(workFolder)),
      String(started.pid),
    );

    expect(result).toMatchObject({
      pid: started.pid,
      agent: 'claude',
      status: 'completed',
      exitCode: 0,
    });
    expect(readFileSync(join(processDir, 'stdout.log'), 'utf8')).toContain('42');
    expect(JSON.parse(readFileSync(join(processDir, 'exit-status.json'), 'utf8'))).toEqual({
      status: 'completed',
      exitCode: 0,
    });
    expect(existsSync(join(stateDir, 'detached-runner-v2.sh'))).toBe(false);
  });

  it('terminates the detached runner process tree and records a failed exit', async () => {
    const { service, workFolder } = createServiceFixture();
    const started = await service.startProcess({
      cwd: workFolder,
      model: 'sonnet',
      prompt: 'setInterval(() => {}, 1000)',
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    const killed = await service.killProcess(started.pid);
    const result = await service.getProcessResult(started.pid);

    expect(killed).toEqual({
      pid: started.pid,
      status: 'terminated',
      message: 'Process terminated successfully',
    });
    expect(result).toMatchObject({
      pid: started.pid,
      status: 'failed',
      exitCode: 143,
    });
  });

  it.runIf(process.platform === 'win32')('runs a .cmd shim through the detached runner', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-cli-node-service-'));
    tempDirs.push(root);
    const fixtureDir = join(root, 'cmd fixture');
    const stateDir = join(root, 'state');
    const workFolder = join(root, 'work');
    mkdirSync(fixtureDir, { recursive: true });
    mkdirSync(workFolder, { recursive: true });
    const scriptPath = join(fixtureDir, 'print-args.cjs');
    const shimPath = join(fixtureDir, 'mock-claude.cmd');
    writeFileSync(scriptPath, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
    writeFileSync(shimPath, `@ECHO off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`);
    const service = new CliProcessService({
      stateDir,
      cliPaths: {
        claude: shimPath,
        codex: shimPath,
        gemini: shimPath,
        opencode: shimPath,
        grok: shimPath,
      },
    });
    const prompt = 'special & | ^ %PATH% " prompt';

    const started = await service.startProcess({ cwd: workFolder, model: 'sonnet', prompt });
    const [result] = await service.waitForProcesses([started.pid], 5);
    const processDir = join(
      stateDir,
      'cwds',
      encodeCwd(realpathSync(workFolder)),
      String(started.pid),
    );

    expect(result).toMatchObject({ status: 'completed', exitCode: 0 });
    expect(JSON.parse(readFileSync(join(processDir, 'stdout.log'), 'utf8'))).toEqual([
      '--dangerously-skip-permissions',
      '--output-format',
      'stream-json',
      '--verbose',
      '-p',
      prompt,
      '--model',
      'sonnet',
    ]);
  });
});
