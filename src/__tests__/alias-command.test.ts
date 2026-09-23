import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALIAS_HELP_TEXT, runCli } from '../app/cli.js';
import { getModelAliases } from '../model-catalog.js';

let root: string;
let configPath: string;

async function cli(...args: string[]) {
  const stdout = vi.fn();
  const stderr = vi.fn();
  const code = await runCli(['alias', ...args], { stdout, stderr });
  return { code, stdout, stderr };
}

function config() {
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ai-cli-alias-command-'));
  configPath = join(root, 'nested', 'config.json');
  vi.stubEnv('AI_CLI_CONFIG_PATH', configPath);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});

describe('ai-cli alias commands', () => {
  it('lists built-in aliases without creating a missing default config', async () => {
    vi.stubEnv('AI_CLI_CONFIG_PATH', undefined);
    vi.stubEnv('XDG_CONFIG_HOME', join(root, 'xdg'));
    const result = await cli('list');
    expect(result.code).toBe(0);
    expect(result.stderr).not.toHaveBeenCalled();
    const payload = JSON.parse(result.stdout.mock.calls[0][0]);
    expect(Object.keys(payload).sort()).toEqual(['aliases', 'configPath']);
    expect(payload.configPath).toBe(join(root, 'xdg', 'ai-cli', 'config.json'));
    expect(payload.aliases.map((alias: any) => alias.name)).toEqual(['claude-ultra', 'codex-ultra', 'gemini-ultra', 'sol', 'luna']);
    expect(payload.aliases).toContainEqual({
      name: 'codex-ultra', resolvesTo: 'gpt-6-astra', agent: 'codex', defaultReasoningEffort: 'ultra',
    });
    expect(existsSync(join(root, 'xdg'))).toBe(false);
  });

  it('lists effective user aliases and built-in overrides without changing config', async () => {
    await cli('add', 'coding', 'gpt-5.6-terra', '--effort', 'xhigh');
    await cli('add', 'codex-ultra', 'gpt-5.6-luna');
    const original = readFileSync(configPath, 'utf8');
    const result = await cli('list');
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout.mock.calls[0][0]);
    expect(payload.configPath).toBe(configPath);
    expect(payload.aliases).toHaveLength(6);
    expect(payload.aliases).toContainEqual({
      name: 'coding', resolvesTo: 'gpt-5.6-terra', agent: 'codex', defaultReasoningEffort: 'xhigh',
    });
    expect(payload.aliases.filter((alias: any) => alias.name === 'codex-ultra')).toEqual([
      { name: 'codex-ultra', resolvesTo: 'gpt-5.6-luna', agent: 'codex' },
    ]);
    expect(readFileSync(configPath, 'utf8')).toBe(original);
  });

  it('does not create a missing explicitly configured file when listing aliases', async () => {
    await expect(cli('list')).rejects.toThrow(configPath);
    expect(existsSync(dirname(configPath))).toBe(false);
  });

  it('creates a missing config and adds an alias with normalized effort', async () => {
    const result = await cli('add', 'codex-coding', 'gpt-5.6-terra', '--effort', ' XHIGH ');
    expect(result.code).toBe(0);
    expect(result.stderr).not.toHaveBeenCalled();
    expect(JSON.parse(result.stdout.mock.calls[0][0])).toMatchObject({
      status: 'added', configPath,
      alias: { name: 'codex-coding', resolvesTo: 'gpt-5.6-terra', agent: 'codex', defaultReasoningEffort: 'xhigh' },
    });
    expect(config()).toEqual({ model_aliases: { 'codex-coding': { model: 'gpt-5.6-terra', reasoning_effort: 'xhigh' } } });
    expect(readdirSync(dirname(configPath))).toEqual(['config.json']);
    if (process.platform !== 'win32') expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it('creates the default user-wide config when no explicit path is configured', async () => {
    vi.stubEnv('AI_CLI_CONFIG_PATH', undefined);
    vi.stubEnv('XDG_CONFIG_HOME', join(root, 'xdg'));
    configPath = join(root, 'xdg', 'ai-cli', 'config.json');
    expect((await cli('add', 'review', 'opus', '--effort=max')).code).toBe(0);
    expect(config().model_aliases.review).toEqual({ model: 'opus', reasoning_effort: 'max' });
  });

  it('preserves other aliases while updating a name and removing its old effort', async () => {
    await cli('add', 'coding', 'gpt-5.6-terra', '--reasoning-effort', 'xhigh');
    await cli('add', 'review', 'opus', '--reasoning_effort', 'high');
    const result = await cli('add', 'coding', 'gpt-6-astra');
    expect(JSON.parse(result.stdout.mock.calls[0][0]).status).toBe('updated');
    expect(config()).toEqual({ model_aliases: {
      coding: { model: 'gpt-6-astra' }, review: { model: 'opus', reasoning_effort: 'high' },
    } });
  });

  it('removes only the named user alias', async () => {
    await cli('add', 'coding', 'gpt-5.6-terra');
    await cli('add', 'review', 'opus');
    const result = await cli('rm', 'coding');
    expect(JSON.parse(result.stdout.mock.calls[0][0])).toEqual({ status: 'removed', name: 'coding', configPath });
    expect(config()).toEqual({ model_aliases: { review: { model: 'opus' } } });
  });

  it.each([['sol', 'gpt-6-sol'], ['luna', 'gpt-6-luna']])('overrides %s and restores its GPT-6 default on removal', async (name, model) => {
    await cli('add', name, 'gpt-5.6-terra', '--effort', 'xhigh');
    const listed = await cli('list');
    expect(JSON.parse(listed.stdout.mock.calls[0][0]).aliases).toContainEqual({
      name, resolvesTo: 'gpt-5.6-terra', agent: 'codex', defaultReasoningEffort: 'xhigh',
    });
    const removed = await cli('rm', name);
    expect(JSON.parse(removed.stdout.mock.calls[0][0]).restoredDefault).toEqual({
      name, resolvesTo: model, agent: 'codex',
    });
    expect(config()).toEqual({ model_aliases: {} });
  });

  it('restores a built-in default when its user override is removed', async () => {
    await cli('add', 'codex-ultra', 'gpt-5.6-luna', '--effort', 'max');
    expect(getModelAliases().find((a) => a.name === 'codex-ultra')?.resolvesTo).toBe('gpt-5.6-luna');
    const result = await cli('rm', 'codex-ultra');
    expect(JSON.parse(result.stdout.mock.calls[0][0]).restoredDefault).toEqual({
      name: 'codex-ultra', resolvesTo: 'gpt-6-astra', agent: 'codex', defaultReasoningEffort: 'ultra',
    });
    expect(config()).toEqual({ model_aliases: {} });
    const original = readFileSync(configPath, 'utf8');
    await expect(cli('rm', 'codex-ultra')).rejects.toThrow('Built-in aliases cannot be removed');
    await expect(cli('rm', 'missing')).rejects.toThrow('not found');
    expect(readFileSync(configPath, 'utf8')).toBe(original);
  });

  it.each([
    ['add', 'bad name', 'opus'],
    ['add', 'opus', 'gpt-6-astra'],
    ['add', 'coding', 'codex-ultra'],
    ['add', 'coding', 'gpt-5.6-luna', '--effort', 'ultra'],
    ['add', 'coding', 'gemini-3.8-flash-medium', '--effort', 'ultra'],
  ])('does not create any files for invalid definitions: %s %s %s', async (...args) => {
    await expect(cli(...args)).rejects.toThrow();
    expect(existsSync(dirname(configPath))).toBe(false);
  });

  it('keeps the original bytes when an update fails validation', async () => {
    await cli('add', 'coding', 'gpt-5.6-terra', '--effort', 'xhigh');
    const original = readFileSync(configPath, 'utf8');
    await expect(cli('add', 'coding', 'gpt-5.6-luna', '--effort', 'ultra')).rejects.toThrow('supports only');
    expect(readFileSync(configPath, 'utf8')).toBe(original);
    expect(readdirSync(dirname(configPath))).toEqual(['config.json']);
  });

  it('does not overwrite malformed existing configuration', async () => {
    configPath = join(root, 'config.json');
    vi.stubEnv('AI_CLI_CONFIG_PATH', configPath);
    writeFileSync(configPath, '{broken config');
    await expect(cli('add', 'coding', 'gpt-5.6-terra')).rejects.toThrow('expected valid JSON');
    await expect(cli('rm', 'coding')).rejects.toThrow('expected valid JSON');
    await expect(cli('list')).rejects.toThrow('expected valid JSON');
    expect(readFileSync(configPath, 'utf8')).toBe('{broken config');
  });

  it('allows removing an alias with an invalid model/effort combination', async () => {
    configPath = join(root, 'config.json');
    vi.stubEnv('AI_CLI_CONFIG_PATH', configPath);
    writeFileSync(configPath, JSON.stringify({ model_aliases: { coding: { model: 'opus', reasoning_effort: 'ultra' } } }));
    await expect(cli('list')).rejects.toThrow('supports only');
    expect((await cli('rm', 'coding')).code).toBe(0);
    expect(config()).toEqual({ model_aliases: {} });
  });

  it.skipIf(process.platform === 'win32')('preserves symlinked configs and existing file permissions', async () => {
    const target = join(root, 'dotfiles.json');
    writeFileSync(target, '{"model_aliases":{"review":{"model":"opus"}}}');
    chmodSync(target, 0o640);
    configPath = join(root, 'config.json');
    symlinkSync(target, configPath);
    vi.stubEnv('AI_CLI_CONFIG_PATH', configPath);
    await cli('add', 'coding', 'gpt-5.6-terra');
    expect(lstatSync(configPath).isSymbolicLink()).toBe(true);
    expect(statSync(target).mode & 0o777).toBe(0o640);
    expect(JSON.parse(readFileSync(target, 'utf8')).model_aliases).toEqual({
      review: { model: 'opus' }, coding: { model: 'gpt-5.6-terra' },
    });
  });

  it.each([
    ['list', 'coding'], ['list', '--effort', 'high'], ['list', '--unknown'],
    ['add'], ['add', 'coding'], ['add', 'coding', 'opus', 'extra'],
    ['add', 'coding', 'opus', '--effort'], ['add', 'coding', 'opus', '--effort='],
    ['add', 'coding', 'opus', '--effrot', 'high'],
    ['add', 'coding', 'opus', '--__proto__=ignored'],
    ['add', 'coding', 'opus', '--', 'extra'],
    ['add', 'coding', 'opus', '--effort', 'high', '--reasoning-effort', 'low'],
    ['add', 'coding', 'opus', '--effort', 'high', '--effort', 'low'],
    ['rm'], ['rm', 'coding', 'opus'], ['rm', 'coding', '--effort', 'high'], ['unknown'],
  ])('rejects malformed command arguments without writing: %j', async (...args) => {
    const result = await cli(...args);
    expect(result.code).toBe(1);
    expect(result.stderr).toHaveBeenCalled();
    expect(existsSync(dirname(configPath))).toBe(false);
  });

  it.each([[], ['--help'], ['list', '--help'], ['add', '--help'], ['rm', '-h']])('shows alias help without writing: %j', async (...args) => {
    const result = await cli(...args);
    expect(result.code).toBe(0);
    expect(result.stdout).toHaveBeenCalledWith(ALIAS_HELP_TEXT);
    expect(result.stderr).not.toHaveBeenCalled();
    expect(existsSync(dirname(configPath))).toBe(false);
  });
});
