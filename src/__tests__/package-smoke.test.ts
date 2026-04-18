import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

const expectedPackageFiles = [
  'CHANGELOG.md',
  'LICENSE',
  'README.ja.md',
  'README.md',
  'dist/app/cli.js',
  'dist/app/mcp.js',
  'dist/bin/ai-cli-mcp.js',
  'dist/bin/ai-cli.js',
  'dist/cli-builder.js',
  'dist/cli-parse.js',
  'dist/cli-process-service.js',
  'dist/cli-utils.js',
  'dist/cli.js',
  'dist/model-catalog.js',
  'dist/parsers.js',
  'dist/peek.js',
  'dist/process-result.js',
  'dist/process-service.js',
  'dist/server.js',
  'package.json',
  'server.json',
].sort();

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function parsePackJson(output: string): any[] {
  const jsonStart = output.indexOf('[');
  if (jsonStart === -1) {
    throw new Error(`npm pack --json did not produce JSON output:\n${output}`);
  }
  return JSON.parse(output.slice(jsonStart));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('npm package smoke', () => {
  it('packs only the runtime files needed by the published package', () => {
    const packDir = makeTempDir('ai-cli-pack-smoke-');
    const output = execFileSync(
      'npm',
      ['pack', '--json', '--pack-destination', packDir],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          HUSKY: '0',
          npm_config_cache: join(packDir, '.npm-cache'),
        },
      }
    );

    const [packed] = parsePackJson(output);
    const filePaths = packed.files.map((file: { path: string }) => file.path).sort();

    expect(filePaths).toEqual(expectedPackageFiles);
    expect(packed.entryCount).toBe(expectedPackageFiles.length);
    expect(filePaths.some((path: string) => path.startsWith('src/'))).toBe(false);
    expect(filePaths.some((path: string) => path.startsWith('.github/'))).toBe(false);
    expect(filePaths.some((path: string) => path.includes('__tests__'))).toBe(false);
    expect(filePaths).not.toContain('package-lock.json');
  });

  it('keeps published bin entrypoints executable through node shebangs', () => {
    expect(readFileSync('dist/bin/ai-cli.js', 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
    expect(readFileSync('dist/bin/ai-cli-mcp.js', 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
  });
});
