import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MCPTestClient } from './utils/mcp-client.js';

type LiveAgent = 'claude' | 'codex' | 'gemini' | 'forge' | 'opencode';
type LiveSurface = 'cli' | 'mcp' | 'all';

const execFileAsync = promisify(execFile);
const liveEnabled = process.env.ACM_LIVE_E2E === '1';
const allAgents: LiveAgent[] = ['claude', 'codex', 'gemini', 'forge', 'opencode'];
const defaultAgents: LiveAgent[] = ['claude', 'codex'];
const liveToken = process.env.ACM_LIVE_E2E_TOKEN || 'ACM_LIVE_E2E_OK';
const assertToken = process.env.ACM_LIVE_E2E_ASSERT_TOKEN !== '0';
const waitTimeoutSeconds = parsePositiveNumber(process.env.ACM_LIVE_E2E_TIMEOUT_SECONDS, 240);
const commandTimeoutMs = parsePositiveNumber(
  process.env.ACM_LIVE_E2E_COMMAND_TIMEOUT_MS,
  (waitTimeoutSeconds + 60) * 1000,
);
const aiCliPath = resolve('dist/bin/ai-cli.js');
const mcpServerPath = resolve('dist/server.js');
const tempDirs: string[] = [];

const defaultModels: Record<LiveAgent, string> = {
  claude: 'haiku',
  codex: 'gpt-5.4',
  gemini: 'gemini-2.5-flash',
  forge: 'forge',
  opencode: 'opencode',
};

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSelectedAgents(): LiveAgent[] {
  const raw = process.env.ACM_LIVE_E2E_AGENTS || defaultAgents.join(',');
  const values = raw.trim().toLowerCase() === 'all'
    ? allAgents
    : raw.split(',').map((value) => value.trim()).filter(Boolean);

  if (values.length === 0) {
    throw new Error('ACM_LIVE_E2E_AGENTS did not select any agents');
  }

  const invalid = values.filter((value) => !allAgents.includes(value as LiveAgent));
  if (invalid.length > 0) {
    throw new Error(`Invalid ACM_LIVE_E2E_AGENTS value(s): ${invalid.join(', ')}`);
  }

  return Array.from(new Set(values as LiveAgent[]));
}

function parseLiveSurface(): LiveSurface {
  const raw = (process.env.ACM_LIVE_E2E_SURFACE || 'cli').trim().toLowerCase();
  if (raw === 'cli' || raw === 'mcp' || raw === 'all') {
    return raw;
  }
  throw new Error(`Invalid ACM_LIVE_E2E_SURFACE value: ${raw}`);
}

function modelForAgent(agent: LiveAgent): string {
  const envName = `ACM_LIVE_E2E_${agent.toUpperCase()}_MODEL`;
  return process.env[envName] || defaultModels[agent];
}

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function parseToolJson(content: any): any {
  expect(content).toHaveLength(1);
  expect(content[0].type).toBe('text');
  return JSON.parse(content[0].text);
}

function stringifyOutputField(value: any): string {
  if (value === undefined || value === null) {
    return '';
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function assertLiveTokenInOutput(result: any): void {
  const output = stringifyOutputField(result.agentOutput);

  expect(
    output,
    'live token should appear in parsed agentOutput, not only in verbose metadata or raw prompt echoes',
  ).toContain(liveToken);
}

async function runAiCliJson(args: string[], env: NodeJS.ProcessEnv): Promise<any> {
  try {
    const { stdout } = await execFileAsync(process.execPath, [aiCliPath, ...args], {
      cwd: process.cwd(),
      env,
      timeout: commandTimeoutMs,
      maxBuffer: 20 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error: any) {
    const stdout = typeof error.stdout === 'string' ? error.stdout : '';
    const stderr = typeof error.stderr === 'string' ? error.stderr : '';
    throw new Error(
      [
        `ai-cli ${args.join(' ')} failed`,
        `message: ${error.message}`,
        stdout ? `stdout:\n${stdout}` : '',
        stderr ? `stderr:\n${stderr}` : '',
      ].filter(Boolean).join('\n\n'),
    );
  }
}

function findExitStatusPath(root: string, pid: number): string | null {
  if (!existsSync(root)) {
    return null;
  }

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = findExitStatusPath(entryPath, pid);
      if (nested) {
        return nested;
      }
      continue;
    }

    if (entry.name === 'exit-status.json' && basename(root) === String(pid)) {
      return entryPath;
    }
  }

  return null;
}

function assertSelectedAgentAvailable(doctorStatus: any, agent: LiveAgent): void {
  const status = doctorStatus[agent];
  expect(status, `doctor output should include ${agent}`).toBeTruthy();
  expect(status.error, `${agent} CLI configuration error`).toBeUndefined();
  expect(status.available, `${agent} CLI should be executable for live E2E`).toBe(true);
}

function assertCompletedLiveResult(result: any, expected: {
  pid: number;
  agent: LiveAgent;
  model: string;
}): void {
  if (result.status === 'completed' && result.exitCode === 0) {
    expect(result).toMatchObject({
      pid: expected.pid,
      agent: expected.agent,
      status: 'completed',
      exitCode: 0,
      model: expected.model,
    });
    expect(
      result.agentOutput || result.stdout || result.stderr,
      'successful live result should include parsed output or raw output',
    ).toBeTruthy();
    return;
  }

  throw new Error(
    [
      `Live ${expected.agent} run failed for pid ${expected.pid}`,
      `status: ${result.status}`,
      `exitCode: ${result.exitCode}`,
      `stdout:\n${result.stdout || ''}`,
      `stderr:\n${result.stderr || ''}`,
      `agentOutput:\n${JSON.stringify(result.agentOutput || null, null, 2)}`,
    ].join('\n\n'),
  );
}

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

if (liveEnabled) {
  describe('live ai-cli E2E against installed AI CLIs', () => {
    const selectedAgents = parseSelectedAgents();
    const liveSurface = parseLiveSurface();
    const stateDir = makeTempDir('acm-live-state-');
    const env = {
      ...process.env,
      AI_CLI_STATE_DIR: stateDir,
    };

    if (liveSurface !== 'mcp') {
      it('checks live prerequisites through ai-cli doctor and models', async () => {
        const doctorStatus = await runAiCliJson(['doctor'], env);

        expect(doctorStatus.checks).toEqual({
          binaryAvailability: true,
          pathResolution: true,
          loginState: false,
          termsAcceptance: false,
        });
        for (const agent of selectedAgents) {
          assertSelectedAgentAvailable(doctorStatus, agent);
        }

        const models = await runAiCliJson(['models'], env);
        expect(models.aliases).toEqual(expect.any(Array));
        expect(models.claude).toContain('haiku');
        expect(models.codex).toContain('gpt-5.4');
        expect(models.gemini).toContain('gemini-2.5-flash');
        expect(models.forge).toEqual(['forge']);
        expect(models.opencode).toEqual(['opencode']);
      });

      it.each(selectedAgents)('runs the real %s CLI through ai-cli', async (agent) => {
        const workDir = makeTempDir(`acm-live-${agent}-`);
        const model = modelForAgent(agent);
        const prompt = `Reply with exactly this token and nothing else: ${liveToken}`;

        const runResult = await runAiCliJson([
          'run',
          '--cwd',
          workDir,
          '--model',
          model,
          '--prompt',
          prompt,
        ], env);

        expect(runResult).toEqual({
          pid: expect.any(Number),
          status: 'started',
          agent,
          message: expect.any(String),
        });

        const processList = await runAiCliJson(['ps'], env);
        expect(processList).toEqual(expect.arrayContaining([
          expect.objectContaining({
            pid: runResult.pid,
            agent,
            status: expect.any(String),
          }),
        ]));

        const peekResult = await runAiCliJson(['peek', String(runResult.pid), '--time', '1'], env);
        expect(peekResult.processes).toHaveLength(1);
        expect(peekResult.processes[0]).toMatchObject({
          pid: runResult.pid,
          agent,
          status: expect.any(String),
          events: expect.any(Array),
        });

        const waitResults = await runAiCliJson([
          'wait',
          String(runResult.pid),
          '--timeout',
          String(waitTimeoutSeconds),
          '--verbose',
        ], env);

        expect(waitResults).toHaveLength(1);
        assertCompletedLiveResult(waitResults[0], {
          pid: runResult.pid,
          agent,
          model,
        });

        const result = await runAiCliJson(['result', String(runResult.pid), '--verbose'], env);
        assertCompletedLiveResult(result, {
          pid: runResult.pid,
          agent,
          model,
        });

        if (assertToken) {
          assertLiveTokenInOutput(result);
        }

        const exitStatusPath = findExitStatusPath(stateDir, runResult.pid);
        expect(exitStatusPath).toEqual(expect.any(String));
        expect(JSON.parse(readFileSync(exitStatusPath!, 'utf-8'))).toEqual({
          status: 'completed',
          exitCode: 0,
        });

        const cleanupResult = await runAiCliJson(['cleanup'], env);
        expect(cleanupResult.removed).toBeGreaterThanOrEqual(1);
        const processListAfterCleanup = await runAiCliJson(['ps'], env);
        expect(processListAfterCleanup.some((entry: any) => entry.pid === runResult.pid)).toBe(false);
      });
    }

    if (liveSurface !== 'cli') {
      describe('MCP server live surface', () => {
        let client: MCPTestClient;

        beforeAll(async () => {
          client = new MCPTestClient(mcpServerPath, {
            ...env,
            VITEST: '',
            MCP_CLAUDE_DEBUG: '',
          }, commandTimeoutMs);
          await client.connect();
        });

        afterAll(async () => {
          await client?.disconnect();
        });

        it('checks live prerequisites through MCP doctor and models', async () => {
          const doctorStatus = parseToolJson(await client.callTool('doctor', {}));

          expect(doctorStatus.checks).toEqual({
            binaryAvailability: true,
            pathResolution: true,
            loginState: false,
            termsAcceptance: false,
          });
          for (const agent of selectedAgents) {
            assertSelectedAgentAvailable(doctorStatus, agent);
          }

          const models = parseToolJson(await client.callTool('models', {}));
          expect(models.aliases).toEqual(expect.any(Array));
          expect(models.claude).toContain('haiku');
          expect(models.codex).toContain('gpt-5.4');
          expect(models.gemini).toContain('gemini-2.5-flash');
          expect(models.forge).toEqual(['forge']);
          expect(models.opencode).toEqual(['opencode']);
        });

        it.each(selectedAgents)('runs the real %s CLI through MCP', async (agent) => {
          const workDir = makeTempDir(`acm-live-mcp-${agent}-`);
          const model = modelForAgent(agent);
          const prompt = `Reply with exactly this token and nothing else: ${liveToken}`;

          const runResult = parseToolJson(await client.callTool('run', {
            prompt,
            workFolder: workDir,
            model,
          }));

          expect(runResult).toEqual({
            pid: expect.any(Number),
            status: 'started',
            agent,
            message: expect.any(String),
          });

          const processList = parseToolJson(await client.callTool('list_processes', {}));
          expect(processList).toEqual(expect.arrayContaining([
            expect.objectContaining({
              pid: runResult.pid,
              agent,
              status: expect.any(String),
            }),
          ]));

          const peekResult = parseToolJson(await client.callTool('peek', {
            pids: [runResult.pid],
            peek_time_sec: 1,
          }));
          expect(peekResult.processes).toHaveLength(1);
          expect(peekResult.processes[0]).toMatchObject({
            pid: runResult.pid,
            agent,
            status: expect.any(String),
            events: expect.any(Array),
          });

          const waitResults = parseToolJson(await client.callTool('wait', {
            pids: [runResult.pid],
            timeout: waitTimeoutSeconds,
            verbose: true,
          }));

          expect(waitResults).toHaveLength(1);
          assertCompletedLiveResult(waitResults[0], {
            pid: runResult.pid,
            agent,
            model,
          });

          const result = parseToolJson(await client.callTool('get_result', {
            pid: runResult.pid,
            verbose: true,
          }));
          assertCompletedLiveResult(result, {
            pid: runResult.pid,
            agent,
            model,
          });

          if (assertToken) {
            assertLiveTokenInOutput(result);
          }

          const cleanupResult = parseToolJson(await client.callTool('cleanup_processes', {}));
          expect(cleanupResult.removedPids).toContain(runResult.pid);
        });
      });
    }
  });
} else {
  describe('live ai-cli E2E disabled', () => {
    it('is opt-in via ACM_LIVE_E2E=1', () => {
      expect(liveEnabled).toBe(false);
    });

    it('does not accept the live token from verbose metadata alone', () => {
      const metadataOnly = {
        prompt: `Reply with exactly this token and nothing else: ${liveToken}`,
        stdout: JSON.stringify({ type: 'user', message: { content: liveToken } }),
        stderr: liveToken,
      };

      expect(() => assertLiveTokenInOutput(metadataOnly)).toThrow();
      expect(() => assertLiveTokenInOutput({
        agentOutput: { message: liveToken },
      })).not.toThrow();
    });
  });
}
