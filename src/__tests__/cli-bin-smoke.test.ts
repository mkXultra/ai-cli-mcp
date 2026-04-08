import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

describe('cli helper entrypoint smoke', () => {
  it('prints help for cli.run with OpenCode examples', () => {
    const output = execFileSync(
      'node',
      ['--import', 'tsx', 'src/cli.ts', '--help'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: process.env,
      }
    );

    expect(output).toContain('Usage: npm run -s cli.run -- --model <model> --workFolder <path> --prompt "..." [options]');
    expect(output).toContain('opencode');
    expect(output).toContain('oc-openai/gpt-5.4');
    expect(output).toContain('OpenCode');
    expect(output).toContain('npm run -s cli.run.parse -- --agent opencode < raw.txt');
  });

  it('prints help for cli.run.parse with OpenCode agent support', () => {
    const output = execFileSync(
      'node',
      ['--import', 'tsx', 'src/cli-parse.ts', '--help'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: process.env,
      }
    );

    expect(output).toContain('Usage: npm run -s cli.run.parse -- --agent <claude|codex|gemini|forge|opencode>');
    expect(output).toContain('Agent type: claude, codex, gemini, forge, or opencode');
    expect(output).toContain('npm run -s cli.run.parse -- --agent opencode < raw.txt');
  });

  it('parses OpenCode NDJSON through cli.run.parse', () => {
    const output = execFileSync(
      'node',
      ['--import', 'tsx', 'src/cli-parse.ts', '--agent', 'opencode'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: process.env,
        input: '{"type":"step_start","sessionID":"ses_cli_parse"}\n{"type":"text","sessionID":"ses_cli_parse","part":{"type":"text","text":"Hello from cli.parse"}}\n{"type":"step_finish","sessionID":"ses_cli_parse","part":{"type":"step-finish","tokens":{"total":9},"cost":1}}\n',
      }
    );

    expect(JSON.parse(output)).toEqual({
      message: 'Hello from cli.parse',
      session_id: 'ses_cli_parse',
      tokens: { total: 9 },
      cost: 1,
    });
  });
});

describe('ai-cli entrypoint smoke', () => {
  it('prints doctor output for the ai-cli entrypoint', () => {
    const fakeBinDir = makeTempDir('ai-cli-bin-');
    writeExecutable(fakeBinDir, 'claude');
    writeExecutable(fakeBinDir, 'codex');
    writeExecutable(fakeBinDir, 'gemini');
    writeExecutable(fakeBinDir, 'forge');
    writeExecutable(fakeBinDir, 'opencode');

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
          OPENCODE_CLI_NAME: 'opencode',
        },
      }
    );

    expect(output).toContain('"claude"');
    expect(output).toContain('"codex"');
    expect(output).toContain('"gemini"');
    expect(output).toContain('"forge"');
    expect(output).toContain('"opencode"');
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
    expect(output).toContain('opencode');
    expect(output).toContain('oc-openai/gpt-5.4');
  });
});
