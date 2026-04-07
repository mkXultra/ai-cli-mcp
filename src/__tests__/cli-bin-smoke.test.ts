import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeExecutable(dir: string, name: string): void {
  const filePath = join(dir, name);
  writeFileSync(filePath, '#!/bin/sh\nexit 0\n', 'utf8');
  chmodSync(filePath, 0o755);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('ai-cli entrypoint smoke', () => {
  it('prints doctor output for the ai-cli entrypoint', () => {
    const fakeBinDir = makeTempDir('ai-cli-bin-');
    writeExecutable(fakeBinDir, 'claude');
    writeExecutable(fakeBinDir, 'codex');
    writeExecutable(fakeBinDir, 'gemini');
    writeExecutable(fakeBinDir, 'forge');

    const output = execFileSync(
      'node',
      ['--import', 'tsx', 'src/bin/ai-cli.ts', 'doctor'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${fakeBinDir}${delimiter}${process.env.PATH || ''}`,
          CLAUDE_CLI_NAME: 'claude',
          CODEX_CLI_NAME: 'codex',
          GEMINI_CLI_NAME: 'gemini',
          FORGE_CLI_NAME: 'forge',
        },
      }
    );

    expect(output).toContain('"claude"');
    expect(output).toContain('"codex"');
    expect(output).toContain('"gemini"');
    expect(output).toContain('"forge"');
    expect(output).toContain('"available": true');
  });

  it('prints run help for the ai-cli entrypoint', () => {
    const output = execFileSync(
      'node',
      ['--import', 'tsx', 'src/bin/ai-cli.ts', 'run', '--help'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: process.env,
      }
    );

    expect(output).toContain('Usage: ai-cli run --cwd <path> [options]');
    expect(output).toContain('--model <model>');
    expect(output).toContain('claude-ultra');
    expect(output).toContain('forge');
  });
});
