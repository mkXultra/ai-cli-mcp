import { describe, expect, it, vi } from 'vitest';
import { CLI_HELP_TEXT, runCli } from '../app/cli.js';

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
