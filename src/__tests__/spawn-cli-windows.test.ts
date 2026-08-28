import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { spawnCli } from '../spawn-cli.js';

const tempDirs: string[] = [];
const originalPath = process.env.PATH;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
  process.env.PATH = originalPath;
});

describe.skipIf(process.platform !== 'win32')('Windows CLI spawning', () => {
  it('preserves spaces and cmd metacharacters when launching a global-style npm shim', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-cli-spawn-'));
    tempDirs.push(root);
    const fixtureDir = join(root, 'path with spaces');
    mkdirSync(fixtureDir, { recursive: true });
    const scriptPath = join(fixtureDir, 'print-args.cjs');
    const shimPath = join(fixtureDir, 'mock-cli.cmd');
    writeFileSync(scriptPath, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
    writeFileSync(
      shimPath,
      `@ECHO off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`,
    );
    const expectedArgs = [
      'plain',
      'space value',
      'amp&ersand',
      'pipe|value',
      'less<more',
      'caret^value',
      'percent%PATH%',
      'bang!value',
      'quote"value',
      'paren(value)',
      'trailing\\',
    ];

    const child = spawnCli(shimPath, expectedArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data) => { stdout += data.toString(); });
    child.stderr?.on('data', (data) => { stderr += data.toString(); });
    const [exitCode] = await once(child, 'close') as [number | null];

    expect(exitCode, stderr).toBe(0);
    expect(JSON.parse(stdout)).toEqual(expectedArgs);
  });

  it('resolves a bare command name through PATHEXT', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-cli-spawn-'));
    tempDirs.push(root);
    const fixtureDir = join(root, 'custom bin');
    mkdirSync(fixtureDir, { recursive: true });
    const scriptPath = join(fixtureDir, 'print-bare-args.cjs');
    const shimPath = join(fixtureDir, 'custom-agent.cmd');
    writeFileSync(scriptPath, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
    writeFileSync(shimPath, `@ECHO off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`);
    process.env.PATH = `${fixtureDir};${originalPath || ''}`;

    const child = spawnCli('custom-agent', ['bare command', 'amp&value'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data) => { stdout += data.toString(); });
    child.stderr?.on('data', (data) => { stderr += data.toString(); });
    const [exitCode] = await once(child, 'close') as [number | null];

    expect(exitCode, stderr).toBe(0);
    expect(JSON.parse(stdout)).toEqual(['bare command', 'amp&value']);
  });

  it('resolves a bare command from the requested working directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-cli-spawn-'));
    tempDirs.push(root);
    const scriptPath = join(root, 'print-cwd.cjs');
    const shimPath = join(root, 'cwd-agent.cmd');
    writeFileSync(scriptPath, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
    writeFileSync(shimPath, `@ECHO off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`);

    const child = spawnCli('cwd-agent', ['cwd argument'], {
      cwd: root,
      env: { ...process.env, PATH: originalPath || '' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data) => { stdout += data.toString(); });
    child.stderr?.on('data', (data) => { stderr += data.toString(); });
    const [exitCode] = await once(child, 'close') as [number | null];

    expect(exitCode, stderr).toBe(0);
    expect(JSON.parse(stdout)).toEqual(['cwd argument']);
  });

  it('resolves a bare command from a relative working directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-cli-spawn-'));
    tempDirs.push(root);
    const scriptPath = join(root, 'print-relative-cwd.cjs');
    const shimPath = join(root, 'relative-cwd-agent.cmd');
    writeFileSync(scriptPath, "process.stdout.write('relative cwd ok');\n");
    writeFileSync(shimPath, `@ECHO off\r\n"${process.execPath}" "${scriptPath}"\r\n`);

    const child = spawnCli('relative-cwd-agent', [], {
      cwd: relative(process.cwd(), root),
      env: { ...process.env, PATH: originalPath || '' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data) => { stdout += data.toString(); });
    child.stderr?.on('data', (data) => { stderr += data.toString(); });
    const [exitCode] = await once(child, 'close') as [number | null];

    expect(exitCode, stderr).toBe(0);
    expect(stdout).toBe('relative cwd ok');
  });

  it('resolves a bare command from the spawn environment PATH', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-cli-spawn-'));
    tempDirs.push(root);
    const fixtureDir = join(root, 'environment bin');
    mkdirSync(fixtureDir, { recursive: true });
    const scriptPath = join(fixtureDir, 'print-env.cjs');
    const shimPath = join(fixtureDir, 'env-agent.cmd');
    writeFileSync(scriptPath, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
    writeFileSync(shimPath, `@ECHO off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`);

    const child = spawnCli('env-agent', ['env argument'], {
      cwd: root,
      env: { ...process.env, PATH: fixtureDir },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data) => { stdout += data.toString(); });
    child.stderr?.on('data', (data) => { stderr += data.toString(); });
    const [exitCode] = await once(child, 'close') as [number | null];

    expect(exitCode, stderr).toBe(0);
    expect(JSON.parse(stdout)).toEqual(['env argument']);
  });

  it('uses the last case-insensitive PATH key from the spawn environment', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-cli-spawn-'));
    tempDirs.push(root);
    const oldBin = join(root, 'old bin');
    const newBin = join(root, 'new bin');
    mkdirSync(oldBin, { recursive: true });
    mkdirSync(newBin, { recursive: true });
    const oldScript = join(oldBin, 'print-old.cjs');
    const newScript = join(newBin, 'print-new.cjs');
    writeFileSync(oldScript, "process.stdout.write('old');\n");
    writeFileSync(newScript, "process.stdout.write('new');\n");
    writeFileSync(join(oldBin, 'duplicate-agent.cmd'), `@ECHO off\r\n"${process.execPath}" "${oldScript}"\r\n`);
    writeFileSync(join(newBin, 'duplicate-agent.cmd'), `@ECHO off\r\n"${process.execPath}" "${newScript}"\r\n`);
    const childEnv = { ...process.env };
    for (const key of Object.keys(childEnv)) {
      if (key.toUpperCase() === 'PATH') {
        delete childEnv[key];
      }
    }
    childEnv.Path = oldBin;
    childEnv.PATH = newBin;

    const child = spawnCli('duplicate-agent', [], {
      cwd: root,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data) => { stdout += data.toString(); });
    child.stderr?.on('data', (data) => { stderr += data.toString(); });
    const [exitCode] = await once(child, 'close') as [number | null];

    expect(exitCode, stderr).toBe(0);
    expect(stdout).toBe('new');
  });

  it('resolves relative PATH entries against the spawn working directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-cli-spawn-'));
    tempDirs.push(root);
    const fixtureDir = join(root, 'bin');
    mkdirSync(fixtureDir, { recursive: true });
    const scriptPath = join(fixtureDir, 'print-relative.cjs');
    writeFileSync(scriptPath, "process.stdout.write('relative path ok');\n");
    writeFileSync(
      join(fixtureDir, 'relative-agent.cmd'),
      `@ECHO off\r\n"${process.execPath}" "${scriptPath}"\r\n`,
    );

    const child = spawnCli('relative-agent', [], {
      cwd: root,
      env: { ...process.env, PATH: 'bin' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data) => { stdout += data.toString(); });
    child.stderr?.on('data', (data) => { stderr += data.toString(); });
    const [exitCode] = await once(child, 'close') as [number | null];

    expect(exitCode, stderr).toBe(0);
    expect(stdout).toBe('relative path ok');
  });

  it('runs an absolute extensionless executable through its shebang', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-cli-spawn-'));
    tempDirs.push(root);
    const scriptPath = join(root, 'extensionless-agent');
    writeFileSync(
      scriptPath,
      `#!${process.execPath}\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n`,
    );

    const child = spawnCli(scriptPath, ['extensionless argument'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data) => { stdout += data.toString(); });
    child.stderr?.on('data', (data) => { stderr += data.toString(); });
    const [exitCode] = await once(child, 'close') as [number | null];

    expect(exitCode, stderr).toBe(0);
    expect(JSON.parse(stdout)).toEqual(['extensionless argument']);
  });

  it('rejects a missing bare command before returning a child PID', () => {
    const command = `missing-agent-${process.pid}-${Date.now()}`;

    expect(() => spawnCli(command, [], { windowsHide: true })).toThrow(
      `spawn ${command} ENOENT`,
    );
  });
});
