import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const runnerPath = fileURLToPath(new URL('../detached-runner.cjs', import.meta.url));
const tempDirs: string[] = [];

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function runDetachedRunner(code: string): Promise<{
  exitCode: number | null;
  processDir: string;
}> {
  const stateDir = mkdtempSync(join(tmpdir(), 'ai-cli-node-runner-'));
  tempDirs.push(stateDir);
  const cwdKey = 'test-cwd';
  const runner = spawn(
    process.execPath,
    [runnerPath, stateDir, cwdKey, process.execPath, '-e', code],
    { stdio: 'ignore', windowsHide: true },
  );
  const pid = runner.pid;
  if (!pid) {
    throw new Error('Failed to start detached runner test process');
  }

  const [exitCode] = await once(runner, 'close') as [number | null];
  return {
    exitCode,
    processDir: join(stateDir, 'cwds', cwdKey, String(pid)),
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe('detached Node.js runner', () => {
  it('captures output and persists a successful exit on every platform', async () => {
    const { exitCode, processDir } = await runDetachedRunner(
      "process.stdout.write('runner stdout'); process.stderr.write('runner stderr');",
    );

    expect(exitCode).toBe(0);
    expect(readFileSync(join(processDir, 'stdout.log'), 'utf8')).toBe('runner stdout');
    expect(readFileSync(join(processDir, 'stderr.log'), 'utf8')).toBe('runner stderr');
    expect(JSON.parse(readFileSync(join(processDir, 'exit-status.json'), 'utf8'))).toEqual({
      status: 'completed',
      exitCode: 0,
    });
  });

  it('persists command startup failures instead of crashing its parent', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'ai-cli-node-runner-'));
    tempDirs.push(stateDir);
    const cwdKey = 'missing-command';
    const missingCommand = join(stateDir, 'does-not-exist');
    const runner = spawn(
      process.execPath,
      [runnerPath, stateDir, cwdKey, missingCommand],
      { stdio: 'ignore', windowsHide: true },
    );
    const pid = runner.pid;
    if (!pid) {
      throw new Error('Failed to start detached runner test process');
    }

    const [exitCode] = await once(runner, 'close') as [number | null];
    const processDir = join(stateDir, 'cwds', cwdKey, String(pid));

    expect(exitCode).toBe(1);
    expect(existsSync(join(processDir, 'exit-status.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(processDir, 'exit-status.json'), 'utf8'))).toEqual({
      status: 'failed',
      exitCode: 1,
    });
    expect(readFileSync(join(processDir, 'stderr.log'), 'utf8')).toContain('Detached runner error:');
  });

  it.runIf(process.platform === 'win32')('resolves a bare .cmd command name on Windows', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-cli-node-runner-'));
    tempDirs.push(root);
    const fixtureDir = join(root, 'custom bin');
    const stateDir = join(root, 'state');
    const cwdKey = 'bare-command';
    mkdirSync(fixtureDir, { recursive: true });
    const scriptPath = join(fixtureDir, 'print-bare.cjs');
    const shimPath = join(fixtureDir, 'custom-agent.cmd');
    writeFileSync(scriptPath, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
    writeFileSync(shimPath, `@ECHO off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`);
    const runner = spawn(
      process.execPath,
      [runnerPath, stateDir, cwdKey, 'custom-agent', 'bare command', 'amp&value'],
      {
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, PATH: `${fixtureDir};${process.env.PATH || ''}` },
      },
    );
    const pid = runner.pid;
    if (!pid) {
      throw new Error('Failed to start detached runner test process');
    }

    const [exitCode] = await once(runner, 'close') as [number | null];
    const processDir = join(stateDir, 'cwds', cwdKey, String(pid));

    expect(exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(processDir, 'stdout.log'), 'utf8'))).toEqual([
      'bare command',
      'amp&value',
    ]);
  });

  it('terminates the spawned child when child PID persistence fails', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'ai-cli-node-runner-'));
    tempDirs.push(stateDir);
    const preloadPath = join(stateDir, 'fail-child-pid-write.cjs');
    const observedPidPath = join(stateDir, 'observed-child-pid');
    writeFileSync(
      preloadPath,
      `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const originalWriteFileSync = fs.writeFileSync.bind(fs);
fs.writeFileSync = (filePath, ...args) => {
  if (path.basename(String(filePath)) === 'child-pid') {
    originalWriteFileSync(process.env.AI_CLI_TEST_OBSERVED_PID_PATH, String(args[0]));
    const error = new Error('injected child-pid write failure');
    error.code = 'EACCES';
    throw error;
  }
  return originalWriteFileSync(filePath, ...args);
};
`,
    );
    const cwdKey = 'pid-write-failure';
    const runner = spawn(
      process.execPath,
      [
        '--require',
        preloadPath,
        runnerPath,
        stateDir,
        cwdKey,
        process.execPath,
        '-e',
        'setInterval(() => {}, 1000)',
      ],
      {
        stdio: 'ignore',
        windowsHide: true,
        env: {
          ...process.env,
          AI_CLI_TEST_OBSERVED_PID_PATH: observedPidPath,
        },
      },
    );
    const pid = runner.pid;
    if (!pid) {
      throw new Error('Failed to start detached runner test process');
    }

    const [exitCode] = await once(runner, 'close') as [number | null];
    const processDir = join(stateDir, 'cwds', cwdKey, String(pid));
    const childPid = Number.parseInt(readFileSync(observedPidPath, 'utf8').trim(), 10);

    expect(exitCode).toBe(1);
    await expect.poll(() => isProcessRunning(childPid), { timeout: 2000 }).toBe(false);
    expect(readFileSync(join(processDir, 'stderr.log'), 'utf8')).toContain(
      'injected child-pid write failure',
    );
    expect(JSON.parse(readFileSync(join(processDir, 'exit-status.json'), 'utf8'))).toEqual({
      status: 'failed',
      exitCode: 1,
    });
  });

  it('terminates the spawned child when closing a log descriptor fails', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'ai-cli-node-runner-'));
    tempDirs.push(stateDir);
    const preloadPath = join(stateDir, 'fail-log-close.cjs');
    writeFileSync(
      preloadPath,
      `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const originalOpenSync = fs.openSync.bind(fs);
const originalCloseSync = fs.closeSync.bind(fs);
const logFds = new Set();
let injected = false;
fs.openSync = (filePath, ...args) => {
  const fd = originalOpenSync(filePath, ...args);
  if (path.basename(String(filePath)) === 'stdout.log' || path.basename(String(filePath)) === 'stderr.log') {
    logFds.add(fd);
  }
  return fd;
};
fs.closeSync = (fd) => {
  if (!injected && logFds.has(fd)) {
    injected = true;
    const error = new Error('injected log close failure');
    error.code = 'EIO';
    throw error;
  }
  return originalCloseSync(fd);
};
`,
    );
    const cwdKey = 'log-close-failure';
    const runner = spawn(
      process.execPath,
      [
        '--require',
        preloadPath,
        runnerPath,
        stateDir,
        cwdKey,
        process.execPath,
        '-e',
        'setInterval(() => {}, 1000)',
      ],
      { stdio: 'ignore', windowsHide: true },
    );
    const pid = runner.pid;
    if (!pid) {
      throw new Error('Failed to start detached runner test process');
    }

    const [exitCode] = await once(runner, 'close') as [number | null];
    const processDir = join(stateDir, 'cwds', cwdKey, String(pid));
    const childPid = Number.parseInt(readFileSync(join(processDir, 'child-pid'), 'utf8').trim(), 10);

    expect(exitCode).toBe(1);
    await expect.poll(() => isProcessRunning(childPid), { timeout: 2000 }).toBe(false);
    expect(readFileSync(join(processDir, 'stderr.log'), 'utf8')).toContain(
      'injected log close failure',
    );
  });

  it('truncates stale logs before starting a reused runner PID directory', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'ai-cli-node-runner-'));
    tempDirs.push(stateDir);
    const preloadPath = join(stateDir, 'seed-stale-logs.cjs');
    const cwdKey = 'stale-logs';
    writeFileSync(
      preloadPath,
      `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const processDir = path.join(process.env.AI_CLI_TEST_STATE_DIR, 'cwds', process.env.AI_CLI_TEST_CWD_KEY, String(process.pid));
fs.mkdirSync(processDir, { recursive: true });
fs.writeFileSync(path.join(processDir, 'stdout.log'), 'stale stdout');
fs.writeFileSync(path.join(processDir, 'stderr.log'), 'stale stderr');
`,
    );
    const runner = spawn(
      process.execPath,
      [
        '--require',
        preloadPath,
        runnerPath,
        stateDir,
        cwdKey,
        process.execPath,
        '-e',
        "process.stdout.write('fresh stdout'); process.stderr.write('fresh stderr');",
      ],
      {
        stdio: 'ignore',
        windowsHide: true,
        env: {
          ...process.env,
          AI_CLI_TEST_STATE_DIR: stateDir,
          AI_CLI_TEST_CWD_KEY: cwdKey,
        },
      },
    );
    const pid = runner.pid;
    if (!pid) {
      throw new Error('Failed to start detached runner test process');
    }

    const [exitCode] = await once(runner, 'close') as [number | null];
    const processDir = join(stateDir, 'cwds', cwdKey, String(pid));

    expect(exitCode).toBe(0);
    expect(readFileSync(join(processDir, 'stdout.log'), 'utf8')).toBe('fresh stdout');
    expect(readFileSync(join(processDir, 'stderr.log'), 'utf8')).toBe('fresh stderr');
  });
});
