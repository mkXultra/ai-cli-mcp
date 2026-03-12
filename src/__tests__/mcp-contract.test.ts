import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanupSharedMock, getSharedMock } from './utils/persistent-mock.js';
import { createTestClient, MCPTestClient } from './utils/mcp-client.js';

function parseToolJson(content: any): any {
  expect(content).toHaveLength(1);
  expect(content[0].type).toBe('text');
  return JSON.parse(content[0].text);
}

function expectProcessSummaryShape(processInfo: any): void {
  expect(processInfo).toEqual({
    pid: expect.any(Number),
    agent: expect.any(String),
    status: expect.any(String),
  });
}

describe('MCP Contract Tests', () => {
  let client: MCPTestClient;
  let testDir: string;

  beforeEach(async () => {
    await getSharedMock();
    testDir = mkdtempSync(join(tmpdir(), 'ai-cli-mcp-contract-'));
    client = createTestClient({ debug: false });
    await client.connect();
  });

  afterEach(async () => {
    await client.disconnect();
    rmSync(testDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await cleanupSharedMock();
  });

  it('registers the current MCP tool contract', async () => {
    const tools = await client.listTools();
    const toolNames = tools.map((tool: any) => tool.name).sort();

    expect(toolNames).toEqual([
      'cleanup_processes',
      'get_result',
      'kill_process',
      'list_processes',
      'run',
      'wait',
    ]);

    const runTool = tools.find((tool: any) => tool.name === 'run');
    expect(runTool.inputSchema.required).toEqual(['workFolder']);
    expect(Object.keys(runTool.inputSchema.properties).sort()).toEqual([
      'model',
      'prompt',
      'prompt_file',
      'reasoning_effort',
      'session_id',
      'workFolder',
    ]);

    const getResultTool = tools.find((tool: any) => tool.name === 'get_result');
    expect(getResultTool.inputSchema.required).toEqual(['pid']);
    expect(Object.keys(getResultTool.inputSchema.properties).sort()).toEqual([
      'pid',
      'verbose',
    ]);

    const waitTool = tools.find((tool: any) => tool.name === 'wait');
    expect(waitTool.inputSchema.required).toEqual(['pids']);
    expect(Object.keys(waitTool.inputSchema.properties).sort()).toEqual([
      'pids',
      'timeout',
    ]);
  });

  it('preserves the stdio MCP smoke flow and response shapes', async () => {
    const runResponse = await client.callTool('run', {
      prompt: 'create a file called contract.txt with content "hello"',
      workFolder: testDir,
      model: 'haiku',
    });
    const runData = parseToolJson(runResponse);

    expect(runData).toEqual({
      pid: expect.any(Number),
      status: 'started',
      agent: 'claude',
      message: expect.any(String),
    });

    const listResponse = await client.callTool('list_processes', {});
    const listData = parseToolJson(listResponse);
    const listedRun = listData.find((entry: any) => entry.pid === runData.pid);

    expect(Array.isArray(listData)).toBe(true);
    expect(listedRun).toBeTruthy();
    expectProcessSummaryShape(listedRun);

    const getResultResponse = await client.callTool('get_result', { pid: runData.pid });
    const getResultData = parseToolJson(getResultResponse);

    expect(getResultData).toMatchObject({
      pid: runData.pid,
      agent: 'claude',
      status: expect.any(String),
      startTime: expect.any(String),
      workFolder: testDir,
      prompt: 'create a file called contract.txt with content "hello"',
      model: 'haiku',
      stdout: expect.any(String),
      stderr: expect.any(String),
    });

    const waitResponse = await client.callTool('wait', { pids: [runData.pid], timeout: 5 });
    const waitData = parseToolJson(waitResponse);

    expect(Array.isArray(waitData)).toBe(true);
    expect(waitData).toHaveLength(1);
    expect(waitData[0].pid).toBe(runData.pid);
    expect(waitData[0].agent).toBe('claude');
    expect(waitData[0].status).toBe('completed');

    const cleanupResponse = await client.callTool('cleanup_processes', {});
    const cleanupData = parseToolJson(cleanupResponse);

    expect(cleanupData).toEqual({
      removed: expect.any(Number),
      removedPids: expect.any(Array),
      message: expect.any(String),
    });
    expect(cleanupData.removedPids).toContain(runData.pid);
  });

  it('accepts prompt_file and keeps the run response shape stable', async () => {
    const promptFile = join(testDir, 'prompt.txt');
    writeFileSync(promptFile, 'create a file called from-file.txt');

    const runResponse = await client.callTool('run', {
      prompt_file: promptFile,
      workFolder: testDir,
    });
    const runData = parseToolJson(runResponse);

    expect(runData).toEqual({
      pid: expect.any(Number),
      status: 'started',
      agent: 'claude',
      message: expect.any(String),
    });
  });

  it('keeps key invalid-input errors stable', async () => {
    await expect(
      client.callTool('run', {
        prompt: 'missing workFolder',
      })
    ).rejects.toThrow(/workFolder/i);

    await expect(
      client.callTool('run', {
        prompt: 'bad dir',
        workFolder: join(testDir, 'missing-dir'),
      })
    ).rejects.toThrow(/does not exist/i);

    const promptFile = join(testDir, 'both.txt');
    writeFileSync(promptFile, 'test');

    await expect(
      client.callTool('run', {
        prompt: 'hello',
        prompt_file: promptFile,
        workFolder: testDir,
      })
    ).rejects.toThrow(/both prompt and prompt_file/i);

    await expect(
      client.callTool('run', {
        workFolder: testDir,
      })
    ).rejects.toThrow(/prompt or prompt_file/i);
  });

  it('keeps unknown PID errors stable for get_result, wait, and kill_process', async () => {
    await expect(
      client.callTool('get_result', { pid: 999999 })
    ).rejects.toThrow(/PID 999999 not found/i);

    await expect(
      client.callTool('wait', { pids: [999999] })
    ).rejects.toThrow(/PID 999999 not found/i);

    await expect(
      client.callTool('kill_process', { pid: 999999 })
    ).rejects.toThrow(/PID 999999 not found/i);
  });

  it('preserves kill_process response shape for a running process', async () => {
    await client.disconnect();

    const slowMockPath = join(testDir, 'slow-claude');
    writeFileSync(
      slowMockPath,
      `#!/bin/bash
prompt=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--prompt)
      prompt="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [[ "$prompt" == *"sleep"* ]]; then
  sleep 5
fi

echo "Command executed successfully"
`
    );
    chmodSync(slowMockPath, 0o755);

    client = createTestClient({ claudeCliName: slowMockPath, debug: false });
    await client.connect();

    const runResponse = await client.callTool('run', {
      prompt: 'sleep for contract kill test',
      workFolder: testDir,
    });
    const runData = parseToolJson(runResponse);

    const killResponse = await client.callTool('kill_process', { pid: runData.pid });
    const killData = parseToolJson(killResponse);

    expect(killData).toEqual({
      pid: runData.pid,
      status: 'terminated',
      message: expect.any(String),
    });
  });
});
