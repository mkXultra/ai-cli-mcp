import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliProcessService } from '../cli-process-service.js';

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

describe('CliProcessService', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('starts a detached process and can wait/list/result from persisted state', async () => {
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
      },
    });

    const runResult = await service.startProcess({
      prompt: 'hello',
      cwd: workFolder,
      model: 'sonnet',
    });

    expect(runResult.pid).toBeGreaterThan(0);
    expect(runResult.status).toBe('started');

    const waitResult = await service.waitForProcesses([runResult.pid], 5);
    expect(waitResult).toHaveLength(1);
    expect(waitResult[0].pid).toBe(runResult.pid);
    expect(waitResult[0].status).toBe('completed');

    const listed = await service.listProcesses();
    expect(listed).toContainEqual({
      pid: runResult.pid,
      agent: 'claude',
      status: 'completed',
    });

    const result = await service.getProcessResult(runResult.pid, false);
    expect(result.pid).toBe(runResult.pid);
    expect(result.status).toBe('completed');
    expect(result.stdout).toContain('Command executed successfully');
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
    mkdirSync(stateDir, { recursive: true });

    const service = new CliProcessService({
      stateDir,
      cliPaths: {
        claude: '/bin/sh',
        codex: '/bin/sh',
        gemini: '/bin/sh',
      },
    });

    const pid = 12345;
    writeFileSync(
      join(stateDir, `${pid}.json`),
      JSON.stringify({
        pid,
        prompt: 'sleep please',
        workFolder: root,
        model: 'sonnet',
        toolType: 'claude',
        startTime: new Date().toISOString(),
        stdoutPath: join(stateDir, `${pid}.stdout.log`),
        stderrPath: join(stateDir, `${pid}.stderr.log`),
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

    const stored = JSON.parse(readFileSync(join(stateDir, `${pid}.json`), 'utf-8'));
    expect(stored.status).toBe('running');
    killSpy.mockRestore();
  });
});
