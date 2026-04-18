import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accessSync } from 'node:fs';

vi.mock('node:fs', () => ({
  accessSync: vi.fn(),
  constants: { X_OK: 1 },
}));

const mockAccessSync = vi.mocked(accessSync);

describe('cli-utils doctor status', () => {
  const originalEnv = process.env;
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetModules();
    mockAccessSync.mockReset();
    process.env = { ...originalEnv };
    delete process.env.CLAUDE_CLI_NAME;
    delete process.env.CODEX_CLI_NAME;
    delete process.env.GEMINI_CLI_NAME;
    delete process.env.FORGE_CLI_NAME;
    delete process.env.OPENCODE_CLI_NAME;
    process.env.PATH = '/mock/bin:/usr/bin';
  });

  afterEach(() => {
    process.env = originalEnv;
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('marks PATH binaries available when they are executable', async () => {
    mockAccessSync.mockImplementation((filePath) => {
      if (filePath === '/mock/bin/claude') {
        return undefined;
      }
      throw new Error('not executable');
    });

    const { getCliDoctorStatus } = await import('../cli-utils.js');
    const status = getCliDoctorStatus();

    expect(status.checks).toEqual({
      binaryAvailability: true,
      pathResolution: true,
      loginState: false,
      termsAcceptance: false,
    });
    expect(status.claude).toEqual({
      configuredCommand: 'claude',
      resolvedPath: '/mock/bin/claude',
      available: true,
      lookup: 'path',
    });
    expect(status.forge).toEqual({
      configuredCommand: 'forge',
      resolvedPath: null,
      available: false,
      lookup: 'path',
    });
    expect(status.opencode).toEqual({
      configuredCommand: 'opencode',
      resolvedPath: null,
      available: false,
      lookup: 'path',
    });
  });

  it('does not mark non-executable PATH entries as available', async () => {
    mockAccessSync.mockImplementation(() => {
      throw new Error('not executable');
    });

    const { getCliDoctorStatus } = await import('../cli-utils.js');
    const status = getCliDoctorStatus();

    expect(status.claude).toEqual({
      configuredCommand: 'claude',
      resolvedPath: null,
      available: false,
      lookup: 'path',
    });
    expect(status.forge).toEqual({
      configuredCommand: 'forge',
      resolvedPath: null,
      available: false,
      lookup: 'path',
    });
    expect(status.opencode).toEqual({
      configuredCommand: 'opencode',
      resolvedPath: null,
      available: false,
      lookup: 'path',
    });
  });

  it('reports invalid relative env paths as doctor errors', async () => {
    process.env.CLAUDE_CLI_NAME = './relative/claude';

    const { getCliDoctorStatus } = await import('../cli-utils.js');
    const status = getCliDoctorStatus();

    expect(status.claude.available).toBe(false);
    expect(status.claude.lookup).toBe('env');
    expect(status.claude.error).toContain('Invalid CLAUDE_CLI_NAME');
  });

  it('reports missing absolute env paths as unavailable', async () => {
    process.env.CLAUDE_CLI_NAME = '/missing/claude';
    mockAccessSync.mockImplementation(() => {
      throw new Error('missing');
    });

    const { getCliDoctorStatus } = await import('../cli-utils.js');
    const status = getCliDoctorStatus();

    expect(status.claude).toEqual({
      configuredCommand: '/missing/claude',
      resolvedPath: '/missing/claude',
      available: false,
      lookup: 'env',
    });
  });

  it('falls back cleanly when PATH is empty', async () => {
    process.env.PATH = '';
    mockAccessSync.mockImplementation(() => {
      throw new Error('missing');
    });

    const { getCliDoctorStatus } = await import('../cli-utils.js');
    const status = getCliDoctorStatus();

    expect(status.codex).toEqual({
      configuredCommand: 'codex',
      resolvedPath: null,
      available: false,
      lookup: 'path',
    });
  });

  it('supports Windows commands that already include an executable suffix', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.PATHEXT = '.EXE;.CMD';
    process.env.CLAUDE_CLI_NAME = 'claude.cmd';
    process.env.PATH = '/mock/bin';
    mockAccessSync.mockImplementation((filePath) => {
      if (filePath === '/mock/bin/claude.cmd') {
        return undefined;
      }
      throw new Error('not executable');
    });

    const { getCliDoctorStatus } = await import('../cli-utils.js');
    const status = getCliDoctorStatus();

    expect(status.claude).toEqual({
      configuredCommand: 'claude.cmd',
      resolvedPath: '/mock/bin/claude.cmd',
      available: true,
      lookup: 'env',
    });
  });

  it('supports forge lookup via FORGE_CLI_NAME', async () => {
    process.env.FORGE_CLI_NAME = 'forge-custom';
    mockAccessSync.mockImplementation((filePath) => {
      if (filePath === '/mock/bin/forge-custom') {
        return undefined;
      }
      throw new Error('not executable');
    });

    const { getCliDoctorStatus, findForgeCli } = await import('../cli-utils.js');
    const status = getCliDoctorStatus();

    expect(status.forge).toEqual({
      configuredCommand: 'forge-custom',
      resolvedPath: '/mock/bin/forge-custom',
      available: true,
      lookup: 'env',
    });
    expect(findForgeCli()).toBe('forge-custom');
  });

  it('supports OpenCode lookup via OPENCODE_CLI_NAME', async () => {
    process.env.OPENCODE_CLI_NAME = 'opencode-custom';
    mockAccessSync.mockImplementation((filePath) => {
      if (filePath === '/mock/bin/opencode-custom') {
        return undefined;
      }
      throw new Error('not executable');
    });

    const { getCliDoctorStatus, findOpencodeCli } = await import('../cli-utils.js');
    const status = getCliDoctorStatus();

    expect(status.opencode).toEqual({
      configuredCommand: 'opencode-custom',
      resolvedPath: '/mock/bin/opencode-custom',
      available: true,
      lookup: 'env',
    });
    expect(findOpencodeCli()).toBe('opencode-custom');
  });
});
