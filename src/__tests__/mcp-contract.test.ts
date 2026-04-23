import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanupSharedMock, getSharedMock } from './utils/persistent-mock.js';
import { createOpenCodeMock } from './utils/opencode-mock.js';
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

function createForgeMockScript(dir: string, argsLogPath: string): string {
  const scriptPath = join(dir, 'mock-forge');
  writeFileSync(
    scriptPath,
    `#!/bin/bash
set -euo pipefail

log_file="${argsLogPath}"
prompt=""
conversation_id=""

printf '%s\\n' "$*" >> "$log_file"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -C)
      shift 2
      ;;
    -p)
      prompt="$2"
      shift 2
      ;;
    --conversation-id)
      conversation_id="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -n "$conversation_id" ]]; then
  printf '● [21:09:33] Continue %s\\n' "$conversation_id"
  printf 'Resumed: %s\\n' "$prompt"
  printf '● [21:09:37] Finished %s\\n' "$conversation_id"
else
  printf '● [21:09:01] Initialize forge-session-1\\n'
  printf 'Initial: %s\\n' "$prompt"
  printf '● [21:09:08] Finished forge-session-1\\n'
fi
`
  );
  chmodSync(scriptPath, 0o755);
  return scriptPath;
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
      'doctor',
      'get_result',
      'kill_process',
      'list_processes',
      'models',
      'peek',
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
    expect(runTool.description).toContain('OpenCode');
    expect(runTool.inputSchema.properties.model.description).toContain('opencode');
    expect(runTool.inputSchema.properties.model.description).toContain('oc-<provider/model>');
    expect(runTool.inputSchema.properties.reasoning_effort.description).toContain('OpenCode do not support reasoning_effort');
    expect(runTool.inputSchema.properties.session_id.description).toBe(
      'Optional session ID to resume a previous session. Supported for Claude, Codex, Gemini, Forge, and OpenCode. OpenCode resumes in-place via --session and may also be combined with explicit oc-<provider/model> selection.'
    );

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
      'verbose',
    ]);

    const peekTool = tools.find((tool: any) => tool.name === 'peek');
    expect(peekTool.inputSchema.required).toEqual(['pids']);
    expect(Object.keys(peekTool.inputSchema.properties).sort()).toEqual([
      'include_tool_calls',
      'peek_time_sec',
      'pids',
    ]);
    expect(peekTool.description).toContain('One-shot');

    const doctorTool = tools.find((tool: any) => tool.name === 'doctor');
    expect(doctorTool.inputSchema.properties).toEqual({});
    expect(doctorTool.description).toContain('binary availability');

    const modelsTool = tools.find((tool: any) => tool.name === 'models');
    expect(modelsTool.inputSchema.properties).toEqual({});
    expect(modelsTool.description).toContain('model aliases');
  });

  it('preserves the stdio MCP smoke flow and response shapes', async () => {
    const modelsResponse = await client.callTool('models', {});
    const modelsData = parseToolJson(modelsResponse);

    expect(modelsData.aliases).toEqual(expect.any(Array));
    expect(modelsData.aliases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'claude-ultra',
          resolvesTo: 'opus',
          agent: 'claude',
          defaultReasoningEffort: 'max',
        }),
      ])
    );
    expect(modelsData.claude).toContain('sonnet');
    expect(modelsData.codex).toEqual([
      'gpt-5.4',
      'gpt-5.5',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'gpt-5.3-codex-spark',
      'gpt-5.2',
    ]);
    expect(modelsData.opencode).toEqual(['opencode']);
    expect(modelsData.dynamicModelBackends.opencode.explicitPattern).toBe('oc-<provider/model>');

    const doctorResponse = await client.callTool('doctor', {});
    const doctorData = parseToolJson(doctorResponse);

    expect(doctorData.checks).toEqual({
      binaryAvailability: true,
      pathResolution: true,
      loginState: false,
      termsAcceptance: false,
    });
    expect(doctorData.claude.configuredCommand).toBe(process.env.TEST_CLAUDE_CLI_NAME);

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
      model: 'haiku',
      stdout: expect.any(String),
      stderr: expect.any(String),
    });
    expect(getResultData).toHaveProperty('exitCode');
    expect(getResultData).not.toHaveProperty('startTime');
    expect(getResultData).not.toHaveProperty('workFolder');
    expect(getResultData).not.toHaveProperty('prompt');

    const waitResponse = await client.callTool('wait', { pids: [runData.pid], timeout: 5 });
    const waitData = parseToolJson(waitResponse);

    expect(Array.isArray(waitData)).toBe(true);
    expect(waitData).toHaveLength(1);
    expect(waitData[0]).toMatchObject({
      pid: runData.pid,
      agent: 'claude',
      status: 'completed',
      exitCode: 0,
      model: 'haiku',
      stdout: expect.any(String),
      stderr: expect.any(String),
    });
    expect(waitData[0]).not.toHaveProperty('startTime');
    expect(waitData[0]).not.toHaveProperty('workFolder');
    expect(waitData[0]).not.toHaveProperty('prompt');

    const cleanupResponse = await client.callTool('cleanup_processes', {});
    const cleanupData = parseToolJson(cleanupResponse);

    expect(cleanupData).toEqual({
      removed: expect.any(Number),
      removedPids: expect.any(Array),
      message: expect.any(String),
    });
    expect(cleanupData.removedPids).toContain(runData.pid);
  });

  it('preserves successful prompt_file execution through the MCP process path', async () => {
    const promptFile = join(testDir, 'prompt.txt');
    writeFileSync(promptFile, 'Create a file from prompt_file');

    const runResponse = await client.callTool('run', {
      prompt_file: promptFile,
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

    const waitResponse = await client.callTool('wait', { pids: [runData.pid], timeout: 5 });
    const waitData = parseToolJson(waitResponse);

    expect(waitData).toHaveLength(1);
    expect(waitData[0]).toMatchObject({
      pid: runData.pid,
      agent: 'claude',
      status: 'completed',
      exitCode: 0,
      model: 'haiku',
      stdout: expect.stringContaining('Created file successfully'),
      stderr: '',
    });
    expect(waitData[0]).not.toHaveProperty('prompt');
    expect(waitData[0]).not.toHaveProperty('workFolder');
    expect(waitData[0]).not.toHaveProperty('startTime');
  });

  it('returns compact results by default and full results when verbose is true for parsed output', async () => {
    await client.disconnect();

    const verboseMockPath = join(testDir, 'verbose-claude');
    writeFileSync(
      verboseMockPath,
      `#!/bin/bash
printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool-1","name":"Read","input":{"file_path":"/tmp/demo.txt"}}]}}'
printf '%s\n' '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tool-1","content":[{"type":"text","text":"demo output"}]}]}}'
printf '%s\n' '{"type":"result","result":"Completed contract verbose test"}'
printf '%s\n' '{"type":"system","session_id":"session-verbose-1"}'
`
    );
    chmodSync(verboseMockPath, 0o755);

    client = createTestClient({ claudeCliName: verboseMockPath, debug: false });
    await client.connect();

    const runResponse = await client.callTool('run', {
      prompt: 'verbose-shape-test',
      workFolder: testDir,
    });
    const runData = parseToolJson(runResponse);

    const completedWait = parseToolJson(await client.callTool('wait', { pids: [runData.pid], timeout: 5 }));
    expect(completedWait).toHaveLength(1);
    expect(completedWait[0].status).toBe('completed');

    const compactResult = parseToolJson(await client.callTool('get_result', { pid: runData.pid }));
    expect(compactResult).toMatchObject({
      pid: runData.pid,
      agent: 'claude',
      status: 'completed',
      exitCode: 0,
      model: null,
      session_id: 'session-verbose-1',
      agentOutput: {
        message: 'Completed contract verbose test',
        session_id: 'session-verbose-1',
      },
    });
    expect(compactResult).not.toHaveProperty('startTime');
    expect(compactResult).not.toHaveProperty('workFolder');
    expect(compactResult).not.toHaveProperty('prompt');
    expect(compactResult.agentOutput).not.toHaveProperty('tools');

    const verboseResult = parseToolJson(await client.callTool('get_result', { pid: runData.pid, verbose: true }));
    expect(verboseResult).toMatchObject({
      pid: runData.pid,
      agent: 'claude',
      status: 'completed',
      exitCode: 0,
      model: null,
      startTime: expect.any(String),
      workFolder: testDir,
      prompt: 'verbose-shape-test',
      session_id: 'session-verbose-1',
      agentOutput: {
        message: 'Completed contract verbose test',
        session_id: 'session-verbose-1',
        tools: [
          {
            tool: 'Read',
            input: { file_path: '/tmp/demo.txt' },
            output: 'demo output',
          },
        ],
      },
    });

    const compactWait = parseToolJson(await client.callTool('wait', { pids: [runData.pid], timeout: 5 }));
    expect(compactWait).toHaveLength(1);
    expect(compactWait[0]).toMatchObject({
      pid: runData.pid,
      agent: 'claude',
      status: 'completed',
      exitCode: 0,
      model: null,
      session_id: 'session-verbose-1',
      agentOutput: {
        message: 'Completed contract verbose test',
        session_id: 'session-verbose-1',
      },
    });
    expect(compactWait[0]).not.toHaveProperty('startTime');
    expect(compactWait[0]).not.toHaveProperty('workFolder');
    expect(compactWait[0]).not.toHaveProperty('prompt');
    expect(compactWait[0].agentOutput).not.toHaveProperty('tools');

    const verboseWait = parseToolJson(await client.callTool('wait', { pids: [runData.pid], timeout: 5, verbose: true }));
    expect(verboseWait).toHaveLength(1);
    expect(verboseWait[0]).toMatchObject({
      pid: runData.pid,
      agent: 'claude',
      status: 'completed',
      exitCode: 0,
      model: null,
      startTime: expect.any(String),
      workFolder: testDir,
      prompt: 'verbose-shape-test',
      session_id: 'session-verbose-1',
      agentOutput: {
        message: 'Completed contract verbose test',
        session_id: 'session-verbose-1',
        tools: [
          {
            tool: 'Read',
            input: { file_path: '/tmp/demo.txt' },
            output: 'demo output',
          },
        ],
      },
    });
  });

  it('covers forge end-to-end through the MCP process path', async () => {
    await client.disconnect();

    const forgeArgsLogPath = join(testDir, 'forge-args.log');
    const forgeMockPath = createForgeMockScript(testDir, forgeArgsLogPath);

    client = createTestClient({
      debug: false,
      env: {
        FORGE_CLI_NAME: forgeMockPath,
      },
    });
    await client.connect();

    const initialRunResponse = await client.callTool('run', {
      prompt: 'forge-initial-prompt',
      workFolder: testDir,
      model: 'forge',
    });
    const initialRunData = parseToolJson(initialRunResponse);

    expect(initialRunData).toEqual({
      pid: expect.any(Number),
      status: 'started',
      agent: 'forge',
      message: expect.any(String),
    });

    const initialWaitResponse = await client.callTool('wait', { pids: [initialRunData.pid], timeout: 5 });
    const initialWaitData = parseToolJson(initialWaitResponse);

    expect(initialWaitData).toHaveLength(1);
    expect(initialWaitData[0]).toMatchObject({
      pid: initialRunData.pid,
      agent: 'forge',
      status: 'completed',
      session_id: 'forge-session-1',
      agentOutput: {
        message: 'Initial: forge-initial-prompt',
        session_id: 'forge-session-1',
      },
    });

    const initialResultResponse = await client.callTool('get_result', { pid: initialRunData.pid });
    const initialResultData = parseToolJson(initialResultResponse);

    expect(initialResultData).toMatchObject({
      pid: initialRunData.pid,
      agent: 'forge',
      status: 'completed',
      session_id: 'forge-session-1',
      agentOutput: {
        message: 'Initial: forge-initial-prompt',
        session_id: 'forge-session-1',
      },
    });

    const resumedRunResponse = await client.callTool('run', {
      prompt: 'forge-resume-prompt',
      workFolder: testDir,
      model: 'forge',
      session_id: 'forge-session-1',
    });
    const resumedRunData = parseToolJson(resumedRunResponse);

    expect(resumedRunData).toEqual({
      pid: expect.any(Number),
      status: 'started',
      agent: 'forge',
      message: expect.any(String),
    });

    const resumedWaitResponse = await client.callTool('wait', { pids: [resumedRunData.pid], timeout: 5 });
    const resumedWaitData = parseToolJson(resumedWaitResponse);

    expect(resumedWaitData).toHaveLength(1);
    expect(resumedWaitData[0]).toMatchObject({
      pid: resumedRunData.pid,
      agent: 'forge',
      status: 'completed',
      session_id: 'forge-session-1',
      agentOutput: {
        message: 'Resumed: forge-resume-prompt',
        session_id: 'forge-session-1',
      },
    });

    const resumedResultResponse = await client.callTool('get_result', { pid: resumedRunData.pid });
    const resumedResultData = parseToolJson(resumedResultResponse);

    expect(resumedResultData).toMatchObject({
      pid: resumedRunData.pid,
      agent: 'forge',
      status: 'completed',
      session_id: 'forge-session-1',
      agentOutput: {
        message: 'Resumed: forge-resume-prompt',
        session_id: 'forge-session-1',
      },
    });

    const forgeInvocations = readFileSync(forgeArgsLogPath, 'utf-8').trim().split('\n');
    expect(forgeInvocations).toHaveLength(2);
    expect(forgeInvocations[0]).toContain(`-C ${testDir}`);
    expect(forgeInvocations[0]).toContain('-p forge-initial-prompt');
    expect(forgeInvocations[0]).not.toContain('--model');
    expect(forgeInvocations[0]).not.toContain('--agent');
    expect(forgeInvocations[0]).not.toContain('--conversation-id');

    expect(forgeInvocations[1]).toContain(`-C ${testDir}`);
    expect(forgeInvocations[1]).toContain('--conversation-id forge-session-1');
    expect(forgeInvocations[1]).toContain('-p forge-resume-prompt');
    expect(forgeInvocations[1]).not.toContain('--model');
    expect(forgeInvocations[1]).not.toContain('--agent');

    await expect(
      client.callTool('run', {
        prompt: 'forge-invalid-reasoning',
        workFolder: testDir,
        model: 'forge',
        reasoning_effort: 'high',
      })
    ).rejects.toThrow(/reasoning_effort is not supported for forge/i);
  });

  it('covers OpenCode end-to-end through the MCP process path', async () => {
    await client.disconnect();

    const opencodeArgsLogPath = join(testDir, 'opencode-args.log');
    const { scriptPath: openCodeMockPath } = createOpenCodeMock(testDir, {
      argsLogPath: opencodeArgsLogPath,
      defaultSessionId: 'ses-opencode-contract',
    });

    client = createTestClient({
      debug: false,
      env: {
        OPENCODE_CLI_NAME: openCodeMockPath,
      },
    });
    await client.connect();

    const initialRunResponse = await client.callTool('run', {
      prompt: 'opencode-initial-prompt',
      workFolder: testDir,
      model: 'opencode',
    });
    const initialRunData = parseToolJson(initialRunResponse);

    expect(initialRunData).toEqual({
      pid: expect.any(Number),
      status: 'started',
      agent: 'opencode',
      message: expect.any(String),
    });

    const initialWaitResponse = await client.callTool('wait', { pids: [initialRunData.pid], timeout: 5 });
    const initialWaitData = parseToolJson(initialWaitResponse);

    expect(initialWaitData).toHaveLength(1);
    expect(initialWaitData[0]).toMatchObject({
      pid: initialRunData.pid,
      agent: 'opencode',
      status: 'completed',
      exitCode: 0,
      model: 'opencode',
      session_id: 'ses-opencode-contract',
      agentOutput: {
        message: 'Initial: opencode-initial-prompt',
        session_id: 'ses-opencode-contract',
        tokens: { total: 11833 },
        cost: 0,
      },
    });

    const resumedDefaultRunResponse = await client.callTool('run', {
      prompt: 'opencode-resume-default',
      workFolder: testDir,
      model: 'opencode',
      session_id: 'ses-opencode-contract',
    });
    const resumedDefaultRunData = parseToolJson(resumedDefaultRunResponse);

    const resumedDefaultWaitResponse = await client.callTool('wait', { pids: [resumedDefaultRunData.pid], timeout: 5 });
    const resumedDefaultWaitData = parseToolJson(resumedDefaultWaitResponse);

    expect(resumedDefaultWaitData).toHaveLength(1);
    expect(resumedDefaultWaitData[0]).toMatchObject({
      pid: resumedDefaultRunData.pid,
      agent: 'opencode',
      status: 'completed',
      exitCode: 0,
      model: 'opencode',
      session_id: 'ses-opencode-contract',
      agentOutput: {
        message: 'Resumed: opencode-resume-default',
        session_id: 'ses-opencode-contract',
        tokens: { total: 11833 },
        cost: 0,
      },
    });

    const resumedExplicitRunResponse = await client.callTool('run', {
      prompt: 'opencode-resume-explicit',
      workFolder: testDir,
      model: 'oc-openai/gpt-5.4',
      session_id: 'ses-opencode-contract',
    });
    const resumedExplicitRunData = parseToolJson(resumedExplicitRunResponse);

    const resumedExplicitWaitResponse = await client.callTool('wait', { pids: [resumedExplicitRunData.pid], timeout: 5 });
    const resumedExplicitWaitData = parseToolJson(resumedExplicitWaitResponse);

    expect(resumedExplicitWaitData).toHaveLength(1);
    expect(resumedExplicitWaitData[0]).toMatchObject({
      pid: resumedExplicitRunData.pid,
      agent: 'opencode',
      status: 'completed',
      exitCode: 0,
      model: 'oc-openai/gpt-5.4',
      session_id: 'ses-opencode-contract',
      agentOutput: {
        message: 'Resumed model openai/gpt-5.4: opencode-resume-explicit',
        session_id: 'ses-opencode-contract',
        tokens: { total: 11833 },
        cost: 0,
      },
    });

    const failedRunResponse = await client.callTool('run', {
      prompt: 'please fail',
      workFolder: testDir,
      model: 'oc-openai/gpt-5.4',
    });
    const failedRunData = parseToolJson(failedRunResponse);

    const compactFailedWait = parseToolJson(await client.callTool('wait', { pids: [failedRunData.pid], timeout: 5 }));
    expect(compactFailedWait).toHaveLength(1);
    expect(compactFailedWait[0]).toMatchObject({
      pid: failedRunData.pid,
      agent: 'opencode',
      status: 'failed',
      exitCode: 7,
      model: 'oc-openai/gpt-5.4',
      session_id: 'ses-opencode-contract',
      stdout: expect.stringContaining('Partial failure output'),
      stderr: expect.stringContaining('OpenCode failed for openai/gpt-5.4'),
    });
    expect(compactFailedWait[0]).not.toHaveProperty('agentOutput');

    const verboseFailedResult = parseToolJson(await client.callTool('get_result', { pid: failedRunData.pid, verbose: true }));
    expect(verboseFailedResult).toMatchObject({
      pid: failedRunData.pid,
      agent: 'opencode',
      status: 'failed',
      exitCode: 7,
      model: 'oc-openai/gpt-5.4',
      session_id: 'ses-opencode-contract',
      stdout: expect.stringContaining('Partial failure output'),
      stderr: expect.stringContaining('OpenCode failed for openai/gpt-5.4'),
      agentOutput: {
        message: 'Partial failure output',
        session_id: 'ses-opencode-contract',
        tokens: { total: 42 },
        cost: 0,
      },
    });

    const openCodeInvocations = readFileSync(opencodeArgsLogPath, 'utf-8').trim().split('\n');
    expect(openCodeInvocations).toHaveLength(4);
    expect(openCodeInvocations[0]).toContain('run --format json');
    expect(openCodeInvocations[0]).toContain(`--dir ${testDir}`);
    expect(openCodeInvocations[0]).not.toContain('--session');
    expect(openCodeInvocations[0]).not.toContain('--model');

    expect(openCodeInvocations[1]).toContain(`--dir ${testDir}`);
    expect(openCodeInvocations[1]).toContain('--session ses-opencode-contract');
    expect(openCodeInvocations[1]).not.toContain('--model');

    expect(openCodeInvocations[2]).toContain(`--dir ${testDir}`);
    expect(openCodeInvocations[2]).toContain('--session ses-opencode-contract');
    expect(openCodeInvocations[2]).toContain('--model openai/gpt-5.4');

    expect(openCodeInvocations[3]).toContain(`--dir ${testDir}`);
    expect(openCodeInvocations[3]).toContain('--model openai/gpt-5.4');

    await expect(
      client.callTool('run', {
        prompt: 'opencode-invalid-reasoning',
        workFolder: testDir,
        model: 'opencode',
        reasoning_effort: 'high',
      })
    ).rejects.toThrow(/reasoning_effort is not supported for opencode/i);
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
