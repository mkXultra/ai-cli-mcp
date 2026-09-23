import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accessSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

vi.mock('node:fs', () => ({
  accessSync: vi.fn(),
  constants: { X_OK: 1 },
}));

const mockAccessSync = vi.mocked(accessSync);

describe('cli-utils doctor status', () => {
  const originalEnv = process.env;
  const originalPlatform = process.platform;
  const mockBinDir = join('mock-root', 'bin');

  beforeEach(() => {
    vi.resetModules();
    mockAccessSync.mockReset();
    process.env = { ...originalEnv };
    delete process.env.CLAUDE_CLI_NAME;
    delete process.env.CODEX_CLI_NAME;
    delete process.env.GEMINI_CLI_NAME;
    delete process.env.ANTIGRAVITY_CLI_NAME;
    delete process.env.OPENCODE_CLI_NAME;
    delete process.env.GROK_CLI_NAME;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.env.PATH = `${mockBinDir}:/usr/bin`;
  });

  afterEach(() => {
    process.env = originalEnv;
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it.each(['linux', 'darwin', 'win32'])('discovers the native agy installation on %s', async (platform) => {
    Object.defineProperty(process, 'platform', { value: platform });
    process.env.LOCALAPPDATA = join(homedir(), 'AppData', 'Local');
    const executable = platform === 'win32'
      ? join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe')
      : join(homedir(), '.local', 'bin', 'agy');
    mockAccessSync.mockImplementation(file => { if (file !== executable) throw new Error('missing'); });
    const { getCliDoctorStatus, findGeminiCli } = await import('../cli-utils.js');
    expect(getCliDoctorStatus().gemini).toMatchObject({ configuredCommand: 'agy', resolvedPath: executable, available: true, lookup: 'local' });
    expect(findGeminiCli()).toBe(executable);
  });

  it('ignores the retired Forge executable override', async () => {
    process.env.FORGE_CLI_NAME = './unsupported/forge';
    const { getCliDoctorStatus } = await import('../cli-utils.js');
    expect(getCliDoctorStatus()).not.toHaveProperty('forge');
    expect(mockAccessSync.mock.calls.flat().some(value => String(value).includes('forge'))).toBe(false);
  });

  it('prioritizes ANTIGRAVITY_CLI_NAME, retaining GEMINI_CLI_NAME as a deprecated override', async () => {
    process.env.ANTIGRAVITY_CLI_NAME = 'agy-custom';
    process.env.GEMINI_CLI_NAME = 'old-override';
    mockAccessSync.mockImplementation(file => { if (file !== join(mockBinDir, 'agy-custom')) throw new Error('missing'); });
    const { getCliDoctorStatus } = await import('../cli-utils.js');
    expect(getCliDoctorStatus().gemini).toMatchObject({ configuredCommand: 'agy-custom', lookup: 'env', available: true });
    delete process.env.ANTIGRAVITY_CLI_NAME;
    expect(getCliDoctorStatus().gemini.configuredCommand).toBe('old-override');
    process.env.ANTIGRAVITY_CLI_NAME = './relative/agy';
    expect(getCliDoctorStatus().gemini.error).toContain('Invalid ANTIGRAVITY_CLI_NAME');
  });

  it('searches PATH for agy without falling back to the old gemini binary', async () => {
    mockAccessSync.mockImplementation(file => { if (file !== join(mockBinDir, 'gemini')) throw new Error('missing'); });
    const { getCliDoctorStatus } = await import('../cli-utils.js');
    expect(getCliDoctorStatus().gemini).toMatchObject({ configuredCommand: 'agy', available: false, lookup: 'path' });
    mockAccessSync.mockImplementation(file => { if (file !== join(mockBinDir, 'agy')) throw new Error('missing'); });
    expect(getCliDoctorStatus().gemini).toMatchObject({ configuredCommand: 'agy', available: true, resolvedPath: join(mockBinDir, 'agy') });
  });

  it('marks PATH binaries available when they are executable', async () => {
    mockAccessSync.mockImplementation((filePath) => {
      if (filePath === join(mockBinDir, 'claude')) {
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
      resolvedPath: join(mockBinDir, 'claude'),
      available: true,
      lookup: 'path',
    });
    expect(status).not.toHaveProperty('forge');
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
    expect(status).not.toHaveProperty('forge');
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
    process.env.CLAUDE_CLI_NAME = 'claude.cmd';
    process.env.PATH = mockBinDir;
    mockAccessSync.mockImplementation((filePath) => {
      if (filePath === join(mockBinDir, 'claude.cmd')) {
        return undefined;
      }
      throw new Error('not executable');
    });

    const { findClaudeCli, getCliDoctorStatus } = await import('../cli-utils.js');
    const status = getCliDoctorStatus();

    expect(status.claude).toEqual({
      configuredCommand: 'claude.cmd',
      resolvedPath: join(mockBinDir, 'claude.cmd'),
      available: true,
      lookup: 'env',
    });
    expect(findClaudeCli()).toBe(join(mockBinDir, 'claude.cmd'));
  });

  it('returns the resolved Windows path for an extensionless custom command name', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.CLAUDE_CLI_NAME = 'claude-custom';
    process.env.PATH = mockBinDir;
    mockAccessSync.mockImplementation((filePath) => {
      if (filePath === join(mockBinDir, 'claude-custom.cmd')) {
        return undefined;
      }
      throw new Error('not executable');
    });

    const { findClaudeCli, getCliDoctorStatus } = await import('../cli-utils.js');
    const status = getCliDoctorStatus();

    expect(status.claude).toEqual({
      configuredCommand: 'claude-custom',
      resolvedPath: join(mockBinDir, 'claude-custom.cmd'),
      available: true,
      lookup: 'env',
    });
    expect(findClaudeCli()).toBe(join(mockBinDir, 'claude-custom.cmd'));
  });

  it('supports OpenCode lookup via OPENCODE_CLI_NAME', async () => {
    process.env.OPENCODE_CLI_NAME = 'opencode-custom';
    mockAccessSync.mockImplementation((filePath) => {
      if (filePath === join(mockBinDir, 'opencode-custom')) {
        return undefined;
      }
      throw new Error('not executable');
    });

    const { getCliDoctorStatus, findOpencodeCli } = await import('../cli-utils.js');
    const status = getCliDoctorStatus();

    expect(status.opencode).toEqual({
      configuredCommand: 'opencode-custom',
      resolvedPath: join(mockBinDir, 'opencode-custom'),
      available: true,
      lookup: 'env',
    });
    expect(findOpencodeCli()).toBe('opencode-custom');
  });

  it('uses a fixed Windows extension order and does not select an extensionless shim', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.PATH = mockBinDir;
    const claudeCandidates: string[] = [];
    mockAccessSync.mockImplementation((filePath) => {
      if (String(filePath).startsWith(join(mockBinDir, 'claude'))) {
        claudeCandidates.push(String(filePath));
      }
      if (filePath === join(mockBinDir, 'claude.cmd')) {
        return undefined;
      }
      throw new Error('not executable');
    });

    const { getCliDoctorStatus } = await import('../cli-utils.js');
    const status = getCliDoctorStatus();

    expect(status.claude.resolvedPath).toBe(join(mockBinDir, 'claude.cmd'));
    expect(claudeCandidates).toEqual([
      join(mockBinDir, 'claude.exe'),
      join(mockBinDir, 'claude.cmd'),
    ]);
    expect(claudeCandidates).not.toContain(join(mockBinDir, 'claude'));
  });

  it('keeps the extensionless PATH lookup unchanged on macOS', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    process.env.PATH = `${mockBinDir}:/usr/bin`;
    mockAccessSync.mockImplementation((filePath) => {
      if (filePath === join(mockBinDir, 'claude')) {
        return undefined;
      }
      throw new Error('not executable');
    });

    const { getCliDoctorStatus } = await import('../cli-utils.js');
    const status = getCliDoctorStatus();

    expect(status.claude.resolvedPath).toBe(join(mockBinDir, 'claude'));
    expect(mockAccessSync.mock.calls.map(([filePath]) => filePath)).not.toContain(
      join(mockBinDir, 'claude.exe'),
    );
  });
});

describe('Grok discovery', () => {
  const originalPlatform = process.platform;
  beforeEach(() => { Object.defineProperty(process, 'platform', { value: 'linux' }); });
  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('prefers the installed Grok binary and honors an absolute override', async () => {
    vi.stubEnv('GROK_CLI_NAME', undefined);
    const { homedir } = await import('node:os');
    const local = join(homedir(), '.grok', 'bin', 'grok');
    mockAccessSync.mockImplementation((p) => {
      if (p !== local && p !== '/test/grok-custom') throw new Error('missing');
    });
    const { getCliDoctorStatus, findGrokCli } = await import('../cli-utils.js');
    expect(getCliDoctorStatus().grok).toMatchObject({ available: true, lookup: 'local', resolvedPath: local });
    expect(findGrokCli()).toBe(local);
    vi.stubEnv('GROK_CLI_NAME', '/test/grok-custom');
    expect(findGrokCli()).toBe('/test/grok-custom');
    expect(getCliDoctorStatus().grok).toMatchObject({ available: true, lookup: 'env', resolvedPath: '/test/grok-custom' });
  });

  it('falls back to PATH, handles bare overrides, and reports missing/invalid commands', async () => {
    vi.stubEnv('GROK_CLI_NAME', undefined);
    vi.stubEnv('PATH', '/test/bin');
    mockAccessSync.mockImplementation((p) => {
      if (p !== join('/test/bin', 'grok') && p !== join('/test/bin', 'grok-custom')) throw new Error('missing');
    });
    const { getCliDoctorStatus, findGrokCli } = await import('../cli-utils.js');
    expect(getCliDoctorStatus().grok).toMatchObject({ available: true, lookup: 'path', resolvedPath: join('/test/bin', 'grok') });
    vi.stubEnv('GROK_CLI_NAME', 'grok-custom');
    expect(getCliDoctorStatus().grok).toMatchObject({ available: true, lookup: 'env', resolvedPath: join('/test/bin', 'grok-custom') });
    vi.stubEnv('GROK_CLI_NAME', '/test/missing');
    expect(getCliDoctorStatus().grok.available).toBe(false);
    vi.stubEnv('GROK_CLI_NAME', './relative');
    expect(() => findGrokCli()).toThrow(/Invalid GROK_CLI_NAME/);
    expect(getCliDoctorStatus().checks.loginState).toBe(false);
  });
});
