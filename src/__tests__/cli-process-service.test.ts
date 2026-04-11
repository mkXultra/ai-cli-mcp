import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliProcessService } from '../cli-process-service.js';
import { createOpenCodeMock } from './utils/opencode-mock.js';

function createMockCliScript(dir: string, name: string, options: { ignoreSigterm?: boolean } = {}): string {
  const scriptPath = join(dir, name);
  writeFileSync(
    scriptPath,
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

${options.ignoreSigterm ? "trap '' TERM\n" : ''}

if [[ "$prompt" == *"sleep"* ]]; then
${options.ignoreSigterm ? '  while true; do sleep 1; done\n' : '  sleep 5\n'}
fi

echo "Command executed successfully"
`
  );
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function encodeCwd(cwd: string): string {
  return cwd
    .split('')
    .map((char) => (/^[A-Za-z0-9.-]$/.test(char) ? char : `_${char.charCodeAt(0).toString(16).padStart(2, '0')}`))
    .join('');
}

describe('CliProcessService', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('starts a detached process and persists state under a normalized cwd directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-cli-cli-service-'));
    tempDirs.push(root);
    const scriptPath = createMockCliScript(root, 'mock-claude');
    const stateDir = join(root, 'state');
    const workFolder = join(root, 'work');
    mkdirSync(workFolder, { recursive: true });

    const service = new CliProcessService({
      stateDir,
      cliPaths: {
        claude: scriptPath,
        codex: scriptPath,
        gemini: scriptPath,
        forge: scriptPath,
        opencode: scriptPath,
      },
    });

    const runResult = await service.startProcess({
      prompt: 'hello',
      cwd: workFolder,
      model: 'sonnet',
    });

    const processDir = join(stateDir, 'cwds', encodeCwd(realpathSync(workFolder)), String(runResult.pid));
    expect(runResult.pid).toBeGreaterThan(0);
    expect(runResult.status).toBe('started');
    expect(existsSync(join(processDir, 'meta.json'))).toBe(true);
    expect(existsSync(join(processDir, 'stdout.log'))).toBe(true);
    expect(existsSync(join(processDir, 'stderr.log'))).toBe(true);

    const waitResult = await service.waitForProcesses([runResult.pid], 5);
    expect(waitResult).toHaveLength(1);
    expect(waitResult[0]).toMatchObject({
      pid: runResult.pid,
      agent: 'claude',
      status: 'completed',
      exitCode: null,
      model: 'sonnet',
      stdout: expect.any(String),
      stderr: expect.any(String),
    });
    expect(waitResult[0]).not.toHaveProperty('startTime');
    expect(waitResult[0]).not.toHaveProperty('workFolder');
    expect(waitResult[0]).not.toHaveProperty('prompt');

    const listed = await service.listProcesses();
    expect(listed).toContainEqual({
      pid: runResult.pid,
      agent: 'claude',
      status: 'completed',
    });

    const result = await service.getProcessResult(runResult.pid, false);
    expect(result).toMatchObject({
      pid: runResult.pid,
      agent: 'claude',
      status: 'completed',
      exitCode: null,
      model: 'sonnet',
      stdout: expect.stringContaining('Command executed successfully'),
      stderr: expect.any(String),
    });
    expect(result).not.toHaveProperty('startTime');
    expect(result).not.toHaveProperty('workFolder');
    expect(result).not.toHaveProperty('prompt');
    expect(readFileSync(join(processDir, 'meta.json'), 'utf-8')).toContain('"status": "completed"');
  });

  it('peeks only appended natural-language messages from detached logs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-cli-cli-service-'));
    tempDirs.push(root);
    const scriptPath = join(root, 'mock-claude-peek');
    writeFileSync(
      scriptPath,
      `#!/bin/bash
printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"old cli message"}]}}'
sleep 2
printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"new cli message"},{"type":"tool_use","id":"tool-1","name":"Read","input":{"file_path":"/tmp/a"}}]}}'
printf '%s\n' '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tool-1","content":"secret"}]}}'
`
    );
    chmodSync(scriptPath, 0o755);
    const stateDir = join(root, 'state');
    const workFolder = join(root, 'work');
    mkdirSync(workFolder, { recursive: true });

    const service = new CliProcessService({
      stateDir,
      cliPaths: {
        claude: scriptPath,
        codex: scriptPath,
        gemini: scriptPath,
        forge: scriptPath,
        opencode: scriptPath,
      },
    });

    const runResult = await service.startProcess({
      prompt: 'hello peek',
      cwd: workFolder,
    });

    const processDir = join(stateDir, 'cwds', encodeCwd(realpathSync(workFolder)), String(runResult.pid));
    const stdoutPath = join(processDir, 'stdout.log');
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5000 && !readFileSync(stdoutPath, 'utf-8').includes('old cli message')) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(readFileSync(stdoutPath, 'utf-8')).toContain('old cli message');

    const peekResult = await service.peekProcesses([runResult.pid, runResult.pid, 999999], 3);

    expect(peekResult.processes).toHaveLength(2);
    expect(peekResult.processes[0]).toMatchObject({
      pid: runResult.pid,
      agent: 'claude',
      status: 'completed',
      messages: [
        {
          ts: expect.any(String),
          text: 'new cli message',
        },
      ],
      truncated: false,
      error: null,
    });
    expect(peekResult.processes[1]).toEqual({
      pid: 999999,
      agent: null,
      status: 'not_found',
      messages: [],
      truncated: false,
      error: 'process not found',
    });
  });

  it('returns compact results by default and full results when verbose is true', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-cli-cli-service-'));
    tempDirs.push(root);
    const scriptPath = join(root, 'mock-claude-json');
    writeFileSync(
      scriptPath,
      `#!/bin/bash
printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool-1","name":"Read","input":{"file_path":"/tmp/demo.txt"}}]}}'
printf '%s\n' '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tool-1","content":[{"type":"text","text":"demo output"}]}]}}'
printf '%s\n' '{"type":"result","result":"Completed cli-process-service test"}'
printf '%s\n' '{"type":"system","session_id":"session-cli-1"}'
`
    );
    chmodSync(scriptPath, 0o755);
    const stateDir = join(root, 'state');
    const workFolder = join(root, 'work');
    mkdirSync(workFolder, { recursive: true });

    const service = new CliProcessService({
      stateDir,
      cliPaths: {
        claude: scriptPath,
        codex: scriptPath,
        gemini: scriptPath,
        forge: scriptPath,
        opencode: scriptPath,
      },
    });

    const runResult = await service.startProcess({
      prompt: 'hello structured output',
      cwd: workFolder,
    });

    const compactWait = await service.waitForProcesses([runResult.pid], 5);
    expect(compactWait).toHaveLength(1);
    expect(compactWait[0]).toMatchObject({
      pid: runResult.pid,
      agent: 'claude',
      status: 'completed',
      exitCode: null,
      model: null,
      session_id: 'session-cli-1',
      agentOutput: {
        message: 'Completed cli-process-service test',
        session_id: 'session-cli-1',
      },
    });
    expect(compactWait[0]).not.toHaveProperty('startTime');
    expect(compactWait[0]).not.toHaveProperty('workFolder');
    expect(compactWait[0]).not.toHaveProperty('prompt');
    expect(compactWait[0].agentOutput).not.toHaveProperty('tools');

    const compactResult = await service.getProcessResult(runResult.pid, false);
    expect(compactResult).toMatchObject({
      pid: runResult.pid,
      agent: 'claude',
      status: 'completed',
      exitCode: null,
      model: null,
      session_id: 'session-cli-1',
      agentOutput: {
        message: 'Completed cli-process-service test',
        session_id: 'session-cli-1',
      },
    });
    expect(compactResult).not.toHaveProperty('startTime');
    expect(compactResult).not.toHaveProperty('workFolder');
    expect(compactResult).not.toHaveProperty('prompt');
    expect(compactResult.agentOutput).not.toHaveProperty('tools');

    const verboseWait = await service.waitForProcesses([runResult.pid], 5, true);
    expect(verboseWait).toHaveLength(1);
    expect(verboseWait[0]).toMatchObject({
      pid: runResult.pid,
      agent: 'claude',
      status: 'completed',
      exitCode: null,
      model: null,
      startTime: expect.any(String),
      workFolder,
      prompt: 'hello structured output',
      session_id: 'session-cli-1',
      agentOutput: {
        message: 'Completed cli-process-service test',
        session_id: 'session-cli-1',
        tools: [
          {
            tool: 'Read',
            input: { file_path: '/tmp/demo.txt' },
            output: 'demo output',
          },
        ],
      },
    });

    const verboseResult = await service.getProcessResult(runResult.pid, true);
    expect(verboseResult).toMatchObject({
      pid: runResult.pid,
      agent: 'claude',
      status: 'completed',
      exitCode: null,
      model: null,
      startTime: expect.any(String),
      workFolder,
      prompt: 'hello structured output',
      session_id: 'session-cli-1',
      agentOutput: {
        message: 'Completed cli-process-service test',
        session_id: 'session-cli-1',
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

  it('can terminate a tracked process', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-cli-cli-service-'));
    tempDirs.push(root);
    const scriptPath = createMockCliScript(root, 'mock-claude');
    const stateDir = join(root, 'state');
    const workFolder = join(root, 'work');
    mkdirSync(workFolder, { recursive: true });

    const service = new CliProcessService({
      stateDir,
      cliPaths: {
        claude: scriptPath,
        codex: scriptPath,
        gemini: scriptPath,
        forge: scriptPath,
        opencode: scriptPath,
      },
    });

    const runResult = await service.startProcess({
      prompt: 'sleep please',
      cwd: workFolder,
      model: 'sonnet',
    });

    await new Promise((resolve) => setTimeout(resolve, 150));

    const killResult = await service.killProcess(runResult.pid);
    expect(killResult).toEqual({
      pid: runResult.pid,
      status: 'terminated',
      message: 'Process terminated successfully',
    });

    const result = await service.getProcessResult(runResult.pid, false);
    expect(result.status).toBe('failed');
  });

  it('does not report termination until the process actually exits', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-cli-cli-service-'));
    tempDirs.push(root);
    const stateDir = join(root, 'state');
    const workFolder = join(root, 'project');
    mkdirSync(workFolder, { recursive: true });
    const pid = 12345;
    const processDir = join(stateDir, 'cwds', encodeCwd(realpathSync(workFolder)), String(pid));
    mkdirSync(processDir, { recursive: true });

    const service = new CliProcessService({
      stateDir,
      cliPaths: {
        claude: '/bin/sh',
        codex: '/bin/sh',
        gemini: '/bin/sh',
        forge: '/bin/sh',
        opencode: '/bin/sh',
      },
    });

    writeFileSync(
      join(processDir, 'meta.json'),
      JSON.stringify({
        pid,
        prompt: 'sleep please',
        workFolder,
        model: 'sonnet',
        toolType: 'claude',
        startTime: new Date().toISOString(),
        stdoutPath: join(processDir, 'stdout.log'),
        stderrPath: join(processDir, 'stderr.log'),
        status: 'running',
      })
    );

    const killSpy = vi.spyOn(globalThis.process, 'kill').mockImplementation((target: number, signal?: string | number) => {
      if (signal === 0) {
        return true;
      }
      if (target === -pid && signal === 'SIGTERM') {
        return true;
      }
      return true;
    });

    const killResult = await service.killProcess(pid);
    expect(killResult).toEqual({
      pid,
      status: 'running',
      message: 'Signal sent but process is still running',
    });

    const stored = JSON.parse(readFileSync(join(processDir, 'meta.json'), 'utf-8'));
    expect(stored.status).toBe('running');
    killSpy.mockRestore();
  });

  it('lists processes without crashing when a tracked work folder has been deleted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-cli-cli-service-'));
    tempDirs.push(root);
    const stateDir = join(root, 'state');
    const workFolder = join(root, 'deleted-project');
    mkdirSync(workFolder, { recursive: true });

    const pid = 45678;
    const processDir = join(stateDir, 'cwds', encodeCwd(realpathSync(workFolder)), String(pid));
    mkdirSync(processDir, { recursive: true });

    writeFileSync(
      join(processDir, 'meta.json'),
      JSON.stringify({
        pid,
        prompt: 'deleted cwd',
        workFolder,
        toolType: 'claude',
        startTime: new Date().toISOString(),
        stdoutPath: join(processDir, 'stdout.log'),
        stderrPath: join(processDir, 'stderr.log'),
        status: 'running',
      })
    );

    rmSync(workFolder, { recursive: true, force: true });

    const service = new CliProcessService({
      stateDir,
      cliPaths: {
        claude: '/bin/sh',
        codex: '/bin/sh',
        gemini: '/bin/sh',
        forge: '/bin/sh',
        opencode: '/bin/sh',
      },
    });

    const killSpy = vi.spyOn(globalThis.process, 'kill').mockImplementation((target: number, signal?: string | number) => {
      if (signal === 0 && target === pid) {
        throw Object.assign(new Error('not running'), { code: 'ESRCH' });
      }
      return true;
    });

    const listed = await service.listProcesses();

    expect(listed).toEqual([
      {
        pid,
        agent: 'claude',
        status: 'completed',
      },
    ]);
    expect(JSON.parse(readFileSync(join(processDir, 'meta.json'), 'utf-8')).status).toBe('completed');
    killSpy.mockRestore();
  });

  it('cleans up finished process directories even when their work folder has been deleted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-cli-cli-service-'));
    tempDirs.push(root);
    const stateDir = join(root, 'state');
    const workFolder = join(root, 'deleted-finished-project');
    mkdirSync(workFolder, { recursive: true });

    const pid = 56789;
    const cwdDir = join(stateDir, 'cwds', encodeCwd(realpathSync(workFolder)));
    const processDir = join(cwdDir, String(pid));
    mkdirSync(processDir, { recursive: true });

    writeFileSync(
      join(processDir, 'meta.json'),
      JSON.stringify({
        pid,
        prompt: 'done',
        workFolder,
        toolType: 'claude',
        startTime: new Date().toISOString(),
        stdoutPath: join(processDir, 'stdout.log'),
        stderrPath: join(processDir, 'stderr.log'),
        status: 'completed',
      })
    );

    rmSync(workFolder, { recursive: true, force: true });

    const service = new CliProcessService({
      stateDir,
      cliPaths: {
        claude: '/bin/sh',
        codex: '/bin/sh',
        gemini: '/bin/sh',
        forge: '/bin/sh',
        opencode: '/bin/sh',
      },
    });

    const result = await service.cleanupProcesses();

    expect(result).toEqual({
      removed: 1,
      message: 'Removed 1 processes',
    });
    expect(existsSync(processDir)).toBe(false);
    expect(existsSync(cwdDir)).toBe(false);
  });

  it('cleans up completed and failed process directories but preserves running ones', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-cli-cli-service-'));
    tempDirs.push(root);
    const stateDir = join(root, 'state');
    const runningCwd = join(root, 'running-project');
    const finishedCwd = join(root, 'finished-project');
    mkdirSync(runningCwd, { recursive: true });
    mkdirSync(finishedCwd, { recursive: true });

    const runningDir = join(stateDir, 'cwds', encodeCwd(realpathSync(runningCwd)), '111');
    const completedDir = join(stateDir, 'cwds', encodeCwd(realpathSync(finishedCwd)), '222');
    const failedDir = join(stateDir, 'cwds', encodeCwd(realpathSync(finishedCwd)), '333');
    mkdirSync(runningDir, { recursive: true });
    mkdirSync(completedDir, { recursive: true });
    mkdirSync(failedDir, { recursive: true });

    writeFileSync(
      join(runningDir, 'meta.json'),
      JSON.stringify({
        pid: 111,
        prompt: 'keep',
        workFolder: runningCwd,
        toolType: 'claude',
        startTime: new Date().toISOString(),
        stdoutPath: join(runningDir, 'stdout.log'),
        stderrPath: join(runningDir, 'stderr.log'),
        status: 'running',
      })
    );
    writeFileSync(
      join(completedDir, 'meta.json'),
      JSON.stringify({
        pid: 222,
        prompt: 'done',
        workFolder: finishedCwd,
        toolType: 'claude',
        startTime: new Date().toISOString(),
        stdoutPath: join(completedDir, 'stdout.log'),
        stderrPath: join(completedDir, 'stderr.log'),
        status: 'completed',
      })
    );
    writeFileSync(
      join(failedDir, 'meta.json'),
      JSON.stringify({
        pid: 333,
        prompt: 'failed',
        workFolder: finishedCwd,
        toolType: 'claude',
        startTime: new Date().toISOString(),
        stdoutPath: join(failedDir, 'stdout.log'),
        stderrPath: join(failedDir, 'stderr.log'),
        status: 'failed',
      })
    );

    const service = new CliProcessService({
      stateDir,
      cliPaths: {
        claude: '/bin/sh',
        codex: '/bin/sh',
        gemini: '/bin/sh',
        forge: '/bin/sh',
        opencode: '/bin/sh',
      },
    });

    const killSpy = vi.spyOn(globalThis.process, 'kill').mockImplementation((target: number, signal?: string | number) => {
      if (signal === 0 && target === 111) {
        return true;
      }
      throw Object.assign(new Error('not running'), { code: 'ESRCH' });
    });

    const result = await service.cleanupProcesses();

    expect(result).toEqual({
      removed: 2,
      message: 'Removed 2 processes',
    });
    expect(existsSync(runningDir)).toBe(true);
    expect(existsSync(completedDir)).toBe(false);
    expect(existsSync(failedDir)).toBe(false);
    killSpy.mockRestore();
  });

  it('parses forge output from detached process logs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-cli-cli-service-'));
    tempDirs.push(root);
    const stateDir = join(root, 'state');
    const workFolder = join(root, 'forge-project');
    mkdirSync(workFolder, { recursive: true });
    const pid = 54321;
    const processDir = join(stateDir, 'cwds', encodeCwd(realpathSync(workFolder)), String(pid));
    mkdirSync(processDir, { recursive: true });

    writeFileSync(
      join(processDir, 'stdout.log'),
      `● [21:09:01] Initialize forge-conv-1
Forge assistant reply
● [21:09:08] Finished forge-conv-1
`
    );
    writeFileSync(join(processDir, 'stderr.log'), '');
    writeFileSync(
      join(processDir, 'meta.json'),
      JSON.stringify({
        pid,
        prompt: 'hello forge',
        workFolder,
        model: 'forge',
        toolType: 'forge',
        startTime: new Date().toISOString(),
        stdoutPath: join(processDir, 'stdout.log'),
        stderrPath: join(processDir, 'stderr.log'),
        status: 'completed',
      })
    );

    const service = new CliProcessService({
      stateDir,
      cliPaths: {
        claude: '/bin/sh',
        codex: '/bin/sh',
        gemini: '/bin/sh',
        forge: '/bin/sh',
        opencode: '/bin/sh',
      },
    });

    const result = await service.getProcessResult(pid, false);
    expect(result.agent).toBe('forge');
    expect(result.session_id).toBe('forge-conv-1');
    expect(result.agentOutput).toEqual({
      message: 'Forge assistant reply',
      session_id: 'forge-conv-1',
    });
  });

  it('parses successful OpenCode detached runs from stdout only', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-cli-cli-service-'));
    tempDirs.push(root);
    const stateDir = join(root, 'state');
    const workFolder = join(root, 'opencode-project');
    mkdirSync(workFolder, { recursive: true });
    const argsLogPath = join(root, 'opencode-args.log');
    const { scriptPath } = createOpenCodeMock(root, { argsLogPath });

    const service = new CliProcessService({
      stateDir,
      cliPaths: {
        claude: '/bin/sh',
        codex: '/bin/sh',
        gemini: '/bin/sh',
        forge: '/bin/sh',
        opencode: scriptPath,
      },
    });

    const runResult = await service.startProcess({
      prompt: 'hello opencode',
      cwd: workFolder,
      model: 'opencode',
    });

    const waited = await service.waitForProcesses([runResult.pid], 5);
    expect(waited).toHaveLength(1);
    expect(waited[0]).toMatchObject({
      pid: runResult.pid,
      agent: 'opencode',
      status: 'completed',
      exitCode: 0,
      model: 'opencode',
      session_id: 'ses-opencode-default',
      agentOutput: {
        message: 'Initial: hello opencode',
        session_id: 'ses-opencode-default',
        tokens: { total: 11833 },
        cost: 0,
      },
    });
    expect(waited[0]).not.toHaveProperty('stdout');
    expect(waited[0]).not.toHaveProperty('stderr');
    expect(readFileSync(argsLogPath, 'utf8')).toContain(`--dir ${workFolder}`);
  });

  it('preserves raw stdout and stderr for failed detached OpenCode runs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-cli-cli-service-'));
    tempDirs.push(root);
    const stateDir = join(root, 'state');
    const workFolder = join(root, 'opencode-fail-project');
    mkdirSync(workFolder, { recursive: true });
    const { scriptPath } = createOpenCodeMock(root);

    const service = new CliProcessService({
      stateDir,
      cliPaths: {
        claude: '/bin/sh',
        codex: '/bin/sh',
        gemini: '/bin/sh',
        forge: '/bin/sh',
        opencode: scriptPath,
      },
    });

    const runResult = await service.startProcess({
      prompt: 'please fail',
      cwd: workFolder,
      model: 'oc-openai/gpt-5.4',
    });

    const [compactResult] = await service.waitForProcesses([runResult.pid], 5);
    expect(compactResult).toMatchObject({
      pid: runResult.pid,
      agent: 'opencode',
      status: 'failed',
      exitCode: 7,
      model: 'oc-openai/gpt-5.4',
      session_id: 'ses-opencode-default',
      stdout: expect.stringContaining('Partial failure output'),
      stderr: expect.stringContaining('OpenCode failed for openai/gpt-5.4'),
    });
    expect(compactResult).not.toHaveProperty('agentOutput');

    const verboseResult = await service.getProcessResult(runResult.pid, true);
    expect(verboseResult).toMatchObject({
      pid: runResult.pid,
      agent: 'opencode',
      status: 'failed',
      exitCode: 7,
      session_id: 'ses-opencode-default',
      stdout: expect.stringContaining('Partial failure output'),
      stderr: expect.stringContaining('OpenCode failed for openai/gpt-5.4'),
      agentOutput: {
        message: 'Partial failure output',
        session_id: 'ses-opencode-default',
        tokens: { total: 42 },
        cost: 0,
      },
    });
  });
});
