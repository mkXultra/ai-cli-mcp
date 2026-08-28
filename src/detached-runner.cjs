'use strict';

const { spawn: nativeSpawn, spawnSync } = require('node:child_process');
const crossSpawn = require('cross-spawn');
const {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  renameSync,
  writeFileSync,
} = require('node:fs');
const { join } = require('node:path');

const SIGNAL_EXIT_CODES = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

function spawnCli(command, args, options) {
  if (process.platform === 'win32') {
    return crossSpawn(command, args, options);
  }
  return nativeSpawn(command, args, options);
}

const [stateDir, cwdKey, command, ...args] = process.argv.slice(2);

if (!stateDir || !cwdKey || !command) {
  process.stderr.write('Usage: detached-runner.cjs <state-dir> <cwd-key> <command> [...args]\n');
  process.exit(2);
}

const pid = process.pid;
const processDir = join(stateDir, 'cwds', cwdKey, String(pid));
const stdoutPath = join(processDir, 'stdout.log');
const stderrPath = join(processDir, 'stderr.log');
const exitStatusPath = join(processDir, 'exit-status.json');
const childPidPath = join(processDir, 'child-pid');

mkdirSync(processDir, { recursive: true });

let child;
let finished = false;
let terminationExitCode;

function appendRunnerError(error) {
  try {
    appendFileSync(stderrPath, `\nDetached runner error: ${error.message}\n`);
  } catch {
    // There is nowhere else safe to report an error from a detached process.
  }
}

function writeExitStatus(status, exitCode) {
  const tempPath = `${exitStatusPath}.${pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify({ status, exitCode }, null, 2)}\n`);
  renameSync(tempPath, exitStatusPath);
}

function finish(status, exitCode) {
  if (finished) {
    return;
  }
  finished = true;

  try {
    writeExitStatus(status, exitCode);
  } catch (error) {
    appendRunnerError(error);
    process.exit(1);
  }

  process.exit(exitCode);
}

function terminateChild(signal, exitCode) {
  if (terminationExitCode !== undefined) {
    return;
  }

  terminationExitCode = exitCode;
  if (!child || !child.pid) {
    finish('failed', terminationExitCode);
    return;
  }

  try {
    if (process.platform === 'win32' && (signal === 'SIGTERM' || signal === 'SIGKILL')) {
      const result = spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      if (result.status === 0) {
        return;
      }
    }

    if (!child.kill(signal)) {
      finish('failed', terminationExitCode);
    }
  } catch (error) {
    appendRunnerError(error);
    finish('failed', terminationExitCode);
  }
}

function handleSignal(signal) {
  terminateChild(signal, SIGNAL_EXIT_CODES[signal] || 1);
}

function attachChildListeners() {
  child.once('error', (error) => {
    appendRunnerError(error);
    finish('failed', terminationExitCode || 1);
  });

  child.once('close', (code, signal) => {
    if (terminationExitCode !== undefined) {
      finish('failed', terminationExitCode);
      return;
    }

    const exitCode = code === null ? SIGNAL_EXIT_CODES[signal] || 1 : code;
    finish(exitCode === 0 ? 'completed' : 'failed', exitCode);
  });
}

function closeLogDescriptors() {
  let closeError;
  for (const fd of [stdoutFd, stderrFd]) {
    if (fd === undefined) {
      continue;
    }
    try {
      closeSync(fd);
    } catch (error) {
      closeError ||= error;
      appendRunnerError(error);
    }
  }

  if (closeError && child && !finished) {
    terminateChild('SIGKILL', 1);
  }
}

for (const signal of Object.keys(SIGNAL_EXIT_CODES)) {
  process.on(signal, () => handleSignal(signal));
}

let stdoutFd;
let stderrFd;

try {
  stdoutFd = openSync(stdoutPath, 'w');
  stderrFd = openSync(stderrPath, 'w');
  child = spawnCli(command, args, {
    cwd: process.cwd(),
    detached: false,
    stdio: ['ignore', stdoutFd, stderrFd],
    windowsHide: true,
  });
  attachChildListeners();
  if (child.pid) {
    try {
      writeFileSync(childPidPath, `${child.pid}\n`);
    } catch (error) {
      appendRunnerError(error);
      terminateChild('SIGKILL', 1);
    }
  }
} catch (error) {
  appendRunnerError(error);
  finish('failed', 1);
} finally {
  closeLogDescriptors();
}
