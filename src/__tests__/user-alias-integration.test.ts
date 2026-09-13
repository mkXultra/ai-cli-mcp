import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestClient, type MCPTestClient } from './utils/mcp-client.js';

let root: string;
let configPath: string;
let argsLog: string;
let env: NodeJS.ProcessEnv;
let client: MCPTestClient | undefined;

function configure(model = 'gpt-5.6-terra', reasoning_effort = 'xhigh'): void {
  writeFileSync(configPath, JSON.stringify({ model_aliases: { 'codex-coding': { model, reasoning_effort } } }));
}

function cli(...args: string[]): any {
  return JSON.parse(execFileSync(process.execPath, ['dist/bin/ai-cli.js', ...args], {
    cwd: process.cwd(), env, encoding: 'utf8', timeout: 15_000,
  }));
}

function parseTool(content: any): any {
  return JSON.parse(content[0].text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ai-cli-user-alias-'));
  configPath = join(root, 'config.json');
  argsLog = join(root, 'args.json');
  const script = join(root, 'mock-codex.cjs');
  writeFileSync(script, `#!/usr/bin/env node
require('node:fs').writeFileSync(${JSON.stringify(argsLog)}, JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'alias-test-session' }));
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'CUSTOM_ALIAS_OK' } }));
`);
  let executable = script;
  if (process.platform === 'win32') {
    executable = join(root, 'mock-codex.cmd');
    writeFileSync(executable, `@ECHO off\r\n"${process.execPath}" "${script}" %*\r\n`);
  } else {
    chmodSync(script, 0o755);
  }
  env = {
    ...process.env,
    VITEST: '',
    AI_CLI_CONFIG_PATH: configPath,
    AI_CLI_STATE_DIR: join(root, 'state'),
    CODEX_CLI_NAME: executable,
  };
  configure();
});

afterEach(async () => {
  if (client) {
    await client.disconnect();
    client = undefined;
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});

describe('user aliases through CLI and MCP', () => {
  it('discovers aliases and executes them through the CLI with explicit effort taking priority', () => {
    cli('alias', 'rm', 'codex-coding');
    const added = cli('alias', 'add', 'codex-coding', 'gpt-5.6-terra', '--effort', 'xhigh');
    expect(added.status).toBe('added');
    expect(cli('models').aliases).toContainEqual({
      name: 'codex-coding', resolvesTo: 'gpt-5.6-terra', agent: 'codex', defaultReasoningEffort: 'xhigh',
    });
    const run = cli('run', '--cwd', root, '--model', 'codex-coding', '--prompt', 'test', '--reasoning-effort', 'low');
    expect(run.agent).toBe('codex');
    const [result] = cli('wait', String(run.pid), '--timeout', '10');
    expect(result).toMatchObject({ status: 'completed', exitCode: 0, agentOutput: { message: 'CUSTOM_ALIAS_OK' } });
    const args = JSON.parse(readFileSync(argsLog, 'utf8'));
    expect(args[args.indexOf('--model') + 1]).toBe('gpt-5.6-terra');
    expect(args).toContain('model_reasoning_effort=low');
    expect(args).not.toContain('model_reasoning_effort=xhigh');
  });

  it('uses the same aliases in MCP discovery and execution, including config edits without restarting', async () => {
    client = createTestClient({ env, debug: false });
    await client.connect();
    const tools = await client.listTools();
    expect(tools.find((t: any) => t.name === 'run').inputSchema.properties.model.description)
      .toContain('"codex-coding" (gpt-5.6-terra; auto xhigh reasoning)');
    expect(parseTool(await client.callTool('models', {})).aliases).toContainEqual({
      name: 'codex-coding', resolvesTo: 'gpt-5.6-terra', agent: 'codex', defaultReasoningEffort: 'xhigh',
    });
    const run = parseTool(await client.callTool('run', {
      workFolder: resolve(root), model: 'codex-coding', prompt: 'test',
    }));
    const [result] = parseTool(await client.callTool('wait', { pids: [run.pid], timeout: 10 }));
    expect(result).toMatchObject({ status: 'completed', exitCode: 0, agentOutput: { message: 'CUSTOM_ALIAS_OK' } });
    const args = JSON.parse(readFileSync(argsLog, 'utf8'));
    expect(args[args.indexOf('--model') + 1]).toBe('gpt-5.6-terra');
    expect(args).toContain('model_reasoning_effort=xhigh');

    const updated = cli('alias', 'add', 'codex-coding', 'gpt-5.6-luna', '--effort', 'max');
    expect(updated.status).toBe('updated');
    expect(parseTool(await client.callTool('models', {})).aliases).toContainEqual({
      name: 'codex-coding', resolvesTo: 'gpt-5.6-luna', agent: 'codex', defaultReasoningEffort: 'max',
    });
    const next = parseTool(await client.callTool('run', {
      workFolder: resolve(root), model: 'codex-coding', prompt: 'test updated config',
    }));
    const [nextResult] = parseTool(await client.callTool('wait', { pids: [next.pid], timeout: 10 }));
    expect(nextResult.exitCode).toBe(0);
    const nextArgs = JSON.parse(readFileSync(argsLog, 'utf8'));
    expect(nextArgs[nextArgs.indexOf('--model') + 1]).toBe('gpt-5.6-luna');
    expect(nextArgs).toContain('model_reasoning_effort=max');
    cli('alias', 'rm', 'codex-coding');
    expect(parseTool(await client.callTool('models', {})).aliases.some((a: any) => a.name === 'codex-coding')).toBe(false);
  });

  it('surfaces invalid config to CLI and MCP users instead of dispatching the alias to another backend', async () => {
    writeFileSync(configPath, '{');
    expect(() => cli('models')).toThrow('expected valid JSON');
    client = createTestClient({ env, debug: false });
    await client.connect();
    await expect(client.callTool('run', {
      workFolder: resolve(root), model: 'codex-coding', prompt: 'test',
    })).rejects.toThrow('expected valid JSON');
    await expect(client.callTool('models', {})).rejects.toThrow('expected valid JSON');
  });
});
