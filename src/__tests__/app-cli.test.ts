import { describe, expect, it, vi } from 'vitest';
import {
  CLI_HELP_TEXT,
  DOCTOR_HELP_TEXT,
  MODELS_HELP_TEXT,
  PEEK_HELP_TEXT,
  RESULT_HELP_TEXT,
  RUN_HELP_TEXT,
  WAIT_HELP_TEXT,
  runCli,
} from '../app/cli.js';

describe('ai-cli app', () => {
  it('prints help and exits successfully when no subcommand is provided', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const startMcpServer = vi.fn();

    const exitCode = await runCli([], {
      stdout,
      stderr,
      startMcpServer,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toHaveBeenCalledWith(CLI_HELP_TEXT);
    expect(stderr).not.toHaveBeenCalled();
    expect(startMcpServer).not.toHaveBeenCalled();
  });

  it('starts MCP mode when the mcp subcommand is provided', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const startMcpServer = vi.fn().mockResolvedValue(undefined);

    const exitCode = await runCli(['mcp'], {
      stdout,
      stderr,
      startMcpServer,
    });

    expect(exitCode).toBe(0);
    expect(startMcpServer).toHaveBeenCalledTimes(1);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it('dispatches run with parsed CLI options', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const startMcpServer = vi.fn();
    const runProcess = vi.fn().mockResolvedValue({
      pid: 123,
      status: 'started',
      agent: 'claude',
      message: 'claude process started successfully',
    });

    const exitCode = await runCli(
      ['run', '--cwd', '/tmp/project', '--prompt', 'hello', '--model', 'sonnet'],
      {
        stdout,
        stderr,
        startMcpServer,
        runProcess,
      }
    );

    expect(exitCode).toBe(0);
    expect(runProcess).toHaveBeenCalledWith({
      cwd: '/tmp/project',
      prompt: 'hello',
      model: 'sonnet',
    });
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"pid": 123'));
    expect(stderr).not.toHaveBeenCalled();
  });

  it('accepts legacy run option aliases', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const runProcess = vi.fn().mockResolvedValue({
      pid: 123,
      status: 'started',
      agent: 'claude',
      message: 'claude process started successfully',
    });

    const exitCode = await runCli(
      [
        'run',
        '--workFolder',
        '/tmp/project',
        '--prompt_file',
        '/tmp/prompt.txt',
        '--session_id',
        'session-123',
        '--reasoning_effort',
        'high',
      ],
      {
        stdout,
        stderr,
        runProcess,
      }
    );

    expect(exitCode).toBe(0);
    expect(runProcess).toHaveBeenCalledWith({
      cwd: '/tmp/project',
      prompt_file: '/tmp/prompt.txt',
      session_id: 'session-123',
      reasoning_effort: 'high',
    });
    expect(stderr).not.toHaveBeenCalled();
  });

  it('requires a prompt or prompt file for run', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();

    const exitCode = await runCli(['run', '--cwd', '/tmp/project'], {
      stdout,
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledWith('Missing required option: --prompt or --prompt-file\n');
    expect(stdout).toHaveBeenCalledWith(CLI_HELP_TEXT);
  });

  it('dispatches wait with pid arguments and timeout', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const waitForProcesses = vi.fn().mockResolvedValue([{ pid: 123, status: 'completed' }]);

    const exitCode = await runCli(
      ['wait', '123', '456', '--timeout', '5'],
      {
        stdout,
        stderr,
        waitForProcesses,
      }
    );

    expect(exitCode).toBe(0);
    expect(waitForProcesses).toHaveBeenCalledWith([123, 456], 5, false);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"status": "completed"'));
  });

  it('passes verbose through to wait', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const waitForProcesses = vi.fn().mockResolvedValue([{ pid: 123, status: 'completed' }]);

    const exitCode = await runCli(
      ['wait', '123', '--verbose'],
      {
        stdout,
        stderr,
        waitForProcesses,
      }
    );

    expect(exitCode).toBe(0);
    expect(waitForProcesses).toHaveBeenCalledWith([123], undefined, true);
  });

  it('rejects invalid wait timeout values', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const waitForProcesses = vi.fn();

    const exitCode = await runCli(['wait', '123', '--timeout', 'abc'], {
      stdout,
      stderr,
      waitForProcesses,
    });

    expect(exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledWith('Invalid --timeout value\n');
    expect(stdout).toHaveBeenCalledWith(CLI_HELP_TEXT);
    expect(waitForProcesses).not.toHaveBeenCalled();
  });

  it('rejects non-integer pid arguments for wait', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const waitForProcesses = vi.fn();

    const exitCode = await runCli(['wait', '123', 'abc'], {
      stdout,
      stderr,
      waitForProcesses,
    });

    expect(exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledWith('All pid arguments must be positive integers\n');
    expect(stdout).toHaveBeenCalledWith(CLI_HELP_TEXT);
    expect(waitForProcesses).not.toHaveBeenCalled();
  });

  it('dispatches peek with deduped pid arguments and time', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const peekProcesses = vi.fn().mockResolvedValue({
      peek_started_at: '2026-04-11T12:34:56.789Z',
      observed_duration_sec: 0.01,
      processes: [],
    });

    const exitCode = await runCli(
      ['peek', '123', '456', '123', '--time', '5', '--include-tool-calls'],
      {
        stdout,
        stderr,
        peekProcesses,
      }
    );

    expect(exitCode).toBe(0);
    expect(peekProcesses).toHaveBeenCalledWith([123, 456], 5, true);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"peek_started_at"'));
    expect(stderr).not.toHaveBeenCalled();
  });

  it('defaults peek time and rejects --follow', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const peekProcesses = vi.fn().mockResolvedValue({
      peek_started_at: '2026-04-11T12:34:56.789Z',
      observed_duration_sec: 0.01,
      processes: [],
    });

    const defaultExitCode = await runCli(['peek', '123'], { stdout, stderr, peekProcesses });
    expect(defaultExitCode).toBe(0);
    expect(peekProcesses).toHaveBeenCalledWith([123], 10, false);

    const followExitCode = await runCli(['peek', '123', '--follow'], { stdout, stderr, peekProcesses });
    expect(followExitCode).toBe(1);
    expect(stderr).toHaveBeenCalledWith('peek does not support --follow in v1\n');
  });

  it('rejects invalid peek time values', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const peekProcesses = vi.fn();

    const exitCode = await runCli(['peek', '123', '--time', '1.5'], {
      stdout,
      stderr,
      peekProcesses,
    });

    expect(exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('peek_time_sec must be a positive integer'));
    expect(peekProcesses).not.toHaveBeenCalled();
  });

  it('dispatches ps, result, and kill', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const listProcesses = vi.fn().mockResolvedValue([{ pid: 123, agent: 'claude', status: 'running' }]);
    const getProcessResult = vi.fn().mockResolvedValue({ pid: 123, status: 'completed' });
    const killProcess = vi.fn().mockResolvedValue({ pid: 123, status: 'terminated' });

    const psExitCode = await runCli(['ps'], { stdout, stderr, listProcesses });
    expect(psExitCode).toBe(0);
    expect(listProcesses).toHaveBeenCalledTimes(1);

    const resultExitCode = await runCli(['result', '123'], { stdout, stderr, getProcessResult });
    expect(resultExitCode).toBe(0);
    expect(getProcessResult).toHaveBeenCalledWith(123, false);

    const killExitCode = await runCli(['kill', '123'], { stdout, stderr, killProcess });
    expect(killExitCode).toBe(0);
    expect(killProcess).toHaveBeenCalledWith(123);
  });

  it('dispatches cleanup', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const cleanupProcesses = vi.fn().mockResolvedValue({ removed: 2, message: 'Removed 2 processes' });

    const exitCode = await runCli(['cleanup'], { stdout, stderr, cleanupProcesses });

    expect(exitCode).toBe(0);
    expect(cleanupProcesses).toHaveBeenCalledTimes(1);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"removed": 2'));
  });

  it('prints models as structured json', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();

    const exitCode = await runCli(['models'], { stdout, stderr });
    const payload = JSON.parse(stdout.mock.calls[0][0]);

    expect(exitCode).toBe(0);
    expect(payload.aliases).toEqual(expect.any(Array));
    expect(payload.aliases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'claude-ultra',
          resolvesTo: 'opus',
          agent: 'claude',
          defaultReasoningEffort: 'max',
        }),
        expect.objectContaining({
          name: 'codex-ultra',
          resolvesTo: 'gpt-5.5',
          agent: 'codex',
          defaultReasoningEffort: 'xhigh',
        }),
      ])
    );
    expect(payload.claude).toContain('sonnet');
    expect(payload.codex).not.toContain('codex');
    expect(payload.codex).toContain('gpt-5.4');
    expect(payload.codex).toContain('gpt-5.5');
    expect(payload.codex).toContain('gpt-5.4-mini');
    expect(payload.codex).toContain('gpt-5.3-codex');
    expect(payload.codex).toContain('gpt-5.3-codex-spark');
    expect(payload.codex).toContain('gpt-5.2');
    expect(payload.forge).toEqual(['forge']);
    expect(payload.opencode).toEqual(['opencode']);
    expect(payload.dynamicModelBackends).toEqual({
      opencode: {
        explicitPrefix: 'oc-',
        explicitPattern: 'oc-<provider/model>',
        discoveryCommand: 'opencode models',
        modelsAreDynamic: true,
      },
    });
    expect(stderr).not.toHaveBeenCalled();
  });

  it('prints doctor status as structured json', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const getDoctorStatus = vi.fn().mockReturnValue({
      checks: {
        binaryAvailability: true,
        pathResolution: true,
        loginState: false,
        termsAcceptance: false,
      },
      claude: {
        configuredCommand: 'claude',
        resolvedPath: '/tmp/bin/claude',
        available: true,
        lookup: 'path',
      },
      codex: {
        configuredCommand: 'codex',
        resolvedPath: null,
        available: false,
        lookup: 'path',
      },
      gemini: {
        configuredCommand: 'gemini',
        resolvedPath: '/tmp/bin/gemini',
        available: true,
        lookup: 'path',
      },
      forge: {
        configuredCommand: 'forge',
        resolvedPath: '/tmp/bin/forge',
        available: true,
        lookup: 'path',
      },
      opencode: {
        configuredCommand: 'opencode',
        resolvedPath: '/tmp/bin/opencode',
        available: true,
        lookup: 'path',
      },
    });

    const exitCode = await runCli(['doctor'], { stdout, stderr, getDoctorStatus });

    expect(exitCode).toBe(0);
    expect(getDoctorStatus).toHaveBeenCalledTimes(1);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"loginState": false'));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"configuredCommand": "claude"'));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"available": false'));
    expect(stderr).not.toHaveBeenCalled();
  });

  it('passes verbose through to result', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const getProcessResult = vi.fn().mockResolvedValue({ pid: 123, status: 'completed' });

    const exitCode = await runCli(['result', '123', '--verbose'], { stdout, stderr, getProcessResult });

    expect(exitCode).toBe(0);
    expect(getProcessResult).toHaveBeenCalledWith(123, true);
  });

  it('prints detailed help for run --help', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();

    const exitCode = await runCli(['run', '--help'], { stdout, stderr });

    expect(exitCode).toBe(0);
    expect(stdout).toHaveBeenCalledWith(RUN_HELP_TEXT);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('claude-ultra'));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('gpt-5.3-codex'));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('gemini-2.5-pro'));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('forge'));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('opencode'));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('oc-openai/gpt-5.4'));
    expect(stderr).not.toHaveBeenCalled();
  });

  it('prints detailed help for result --help', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();

    const exitCode = await runCli(['result', '--help'], { stdout, stderr });

    expect(exitCode).toBe(0);
    expect(stdout).toHaveBeenCalledWith(RESULT_HELP_TEXT);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('compact result shape'));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('--verbose'));
    expect(stderr).not.toHaveBeenCalled();
  });

  it('prints detailed help for wait --help', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();

    const exitCode = await runCli(['wait', '--help'], { stdout, stderr });

    expect(exitCode).toBe(0);
    expect(stdout).toHaveBeenCalledWith(WAIT_HELP_TEXT);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('compact shape'));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('--verbose'));
    expect(stderr).not.toHaveBeenCalled();
  });

  it('prints detailed help for peek --help', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();

    const exitCode = await runCli(['peek', '--help'], { stdout, stderr });

    expect(exitCode).toBe(0);
    expect(stdout).toHaveBeenCalledWith(PEEK_HELP_TEXT);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('No --follow mode'));
    expect(stderr).not.toHaveBeenCalled();
  });

  it('prints detailed help for models --help', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();

    const exitCode = await runCli(['models', '--help'], { stdout, stderr });

    expect(exitCode).toBe(0);
    expect(stdout).toHaveBeenCalledWith(MODELS_HELP_TEXT);
    expect(stderr).not.toHaveBeenCalled();
  });

  it('prints detailed help for doctor --help', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();

    const exitCode = await runCli(['doctor', '--help'], { stdout, stderr });

    expect(exitCode).toBe(0);
    expect(stdout).toHaveBeenCalledWith(DOCTOR_HELP_TEXT);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('OpenCode'));
    expect(stderr).not.toHaveBeenCalled();
  });

  it('prints detailed help for doctor -h', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();

    const exitCode = await runCli(['doctor', '-h'], { stdout, stderr });

    expect(exitCode).toBe(0);
    expect(stdout).toHaveBeenCalledWith(DOCTOR_HELP_TEXT);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('OpenCode'));
    expect(stderr).not.toHaveBeenCalled();
  });

  it('prints help for --help', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const startMcpServer = vi.fn();

    const exitCode = await runCli(['--help'], {
      stdout,
      stderr,
      startMcpServer,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toHaveBeenCalledWith(CLI_HELP_TEXT);
    expect(stderr).not.toHaveBeenCalled();
  });

  it('returns a non-zero exit code for unknown subcommands', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const startMcpServer = vi.fn();

    const exitCode = await runCli(['unknown'], {
      stdout,
      stderr,
      startMcpServer,
    });

    expect(exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Unknown subcommand: unknown'));
    expect(stdout).toHaveBeenCalledWith(CLI_HELP_TEXT);
    expect(startMcpServer).not.toHaveBeenCalled();
  });
});
