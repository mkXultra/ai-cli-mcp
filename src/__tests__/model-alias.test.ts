import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCliCommand, resolveModelAlias } from '../cli-builder.js';
import { getModelAliases, getModelParameterDescription, getModelsPayload, MODEL_ALIAS_DETAILS } from '../model-catalog.js';
import { getUserConfigPath, loadUserModelAliases } from '../model-config.js';

let root: string;
let configPath: string;

function configure(model_aliases: unknown): void {
  writeFileSync(configPath, JSON.stringify({ model_aliases }));
}

function command(model: string, reasoning_effort?: string) {
  return buildCliCommand({
    workFolder: root,
    prompt: 'test',
    model,
    reasoning_effort,
    cliPaths: { codex: 'codex', claude: 'claude', gemini: 'gemini', forge: 'forge', opencode: 'opencode' },
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ai-cli-alias-'));
  configPath = join(root, 'config.json');
  writeFileSync(configPath, '{}');
  vi.stubEnv('AI_CLI_CONFIG_PATH', configPath);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('user config loading', () => {
  it('uses the shared home config by default and honors an absolute XDG_CONFIG_HOME', () => {
    vi.stubEnv('AI_CLI_CONFIG_PATH', undefined);
    vi.stubEnv('XDG_CONFIG_HOME', undefined);
    expect(getUserConfigPath()).toBe(join(homedir(), '.config', 'ai-cli', 'config.json'));
    vi.stubEnv('XDG_CONFIG_HOME', root);
    expect(getUserConfigPath()).toBe(join(root, 'ai-cli', 'config.json'));
    expect(getModelAliases()).toEqual(MODEL_ALIAS_DETAILS);
    mkdirSync(join(root, 'ai-cli'));
    writeFileSync(join(root, 'ai-cli', 'config.json'), JSON.stringify({
      model_aliases: { 'codex-coding': { model: 'gpt-5.6-terra', reasoning_effort: 'xhigh' } },
    }));
    expect(resolveModelAlias('codex-coding')).toBe('gpt-5.6-terra');
    vi.stubEnv('XDG_CONFIG_HOME', 'relative/config');
    expect(getUserConfigPath()).toBe(join(homedir(), '.config', 'ai-cli', 'config.json'));
  });

  it('gives the explicit config path priority and resolves relative paths from process cwd', () => {
    vi.stubEnv('XDG_CONFIG_HOME', join(root, 'ignored'));
    expect(getUserConfigPath()).toBe(configPath);
    vi.stubEnv('AI_CLI_CONFIG_PATH', 'custom/config.json');
    expect(getUserConfigPath()).toBe(resolve('custom/config.json'));
  });

  it('reports missing explicit config files instead of silently falling back', () => {
    vi.stubEnv('AI_CLI_CONFIG_PATH', join(root, 'missing.json'));
    expect(loadUserModelAliases).toThrow('Cannot read AI CLI config');
    expect(loadUserModelAliases).toThrow('missing.json');
  });

  it('reports unreadable config paths', () => {
    vi.stubEnv('AI_CLI_CONFIG_PATH', root);
    expect(loadUserModelAliases).toThrow('Cannot read AI CLI config');
  });

  it.each([
    ['{', 'expected valid JSON'],
    ['null', 'expected an object'],
    ['[]', 'expected an object'],
    ['{"model_alias": {}}', 'only supported setting'],
    ['{"model_aliases": null}', 'must be an object'],
    ['{"model_aliases": []}', 'must be an object'],
  ])('rejects malformed config: %s', (contents, message) => {
    writeFileSync(configPath, contents);
    expect(getModelAliases).toThrow(message);
    expect(getModelAliases).toThrow(configPath);
  });

  it.each([
    [{ 'bad name': { model: 'opus' } }, 'must start with a letter'],
    [{ 'oc-coding': { model: 'opus' } }, 'reserved "oc-" prefix'],
    [{ coding: 'opus' }, 'must contain a nonempty "model"'],
    [{ coding: { model: '' } }, 'must contain a nonempty "model"'],
    [{ coding: { model: ' opus' } }, 'without whitespace'],
    [{ coding: { model: 'opus', reasoning_effort: null } }, 'nonempty string'],
    [{ coding: { model: 'opus', reasoning_effort: ' ' } }, 'nonempty string'],
    [{ coding: { model: 'opus', reasoningEffort: 'high' } }, 'supports only'],
    [{ opus: { model: 'gpt-6-astra' } }, 'cannot replace native model names'],
    [{ coding: { model: 'codex-ultra' } }, 'alias chaining is not supported'],
    [{ coding: { model: 'coding' } }, 'alias chaining is not supported'],
    [{ coding: { model: 'review' }, review: { model: 'coding' } }, 'alias chaining is not supported'],
    [{ coding: { model: 'oc-openai' } }, 'Invalid OpenCode model'],
    [{ coding: { model: 'gpt-5.6-luna', reasoning_effort: 'ultra' } }, 'supports only low, medium, high, xhigh, max'],
    [{ coding: { model: 'opus', reasoning_effort: 'ultra' } }, 'Claude reasoning_effort supports only'],
    [{ coding: { model: 'gemini-2.5-pro', reasoning_effort: 'high' } }, 'only supported for Claude and Codex'],
    [{ coding: { model: 'forge', reasoning_effort: 'high' } }, 'not supported for forge'],
    [{ coding: { model: 'oc-openai/gpt-5.4', reasoning_effort: 'high' } }, 'not supported for opencode'],
  ])('rejects invalid aliases %#', (aliases, message) => {
    configure(aliases);
    expect(getModelAliases).toThrow(message);
    expect(getModelAliases).toThrow(configPath);
  });
});

describe('configured alias resolution', () => {
  it('keeps built-in aliases and literal models working when no aliases are configured', () => {
    expect(getModelAliases()).toEqual(MODEL_ALIAS_DETAILS);
    expect(resolveModelAlias('codex-ultra')).toBe('gpt-6-astra');
    expect(command('codex-ultra').args).toContain('model_reasoning_effort=ultra');
    expect(resolveModelAlias('sonnet')).toBe('sonnet');
    expect(resolveModelAlias('')).toBe('');
    expect(resolveModelAlias('toString')).toBe('toString');
    expect(resolveModelAlias('constructor')).toBe('constructor');
  });

  it('routes codex-coding to Terra with xhigh, and lets explicit effort win', () => {
    configure({ 'codex-coding': { model: 'gpt-5.6-terra', reasoning_effort: 'xhigh' } });
    const cmd = command('codex-coding');
    expect(cmd).toMatchObject({ agent: 'codex', cliPath: 'codex', resolvedModel: 'gpt-5.6-terra' });
    expect(cmd.args).toContain('model_reasoning_effort=xhigh');
    expect(cmd.args[cmd.args.indexOf('--model') + 1]).toBe('gpt-5.6-terra');
    expect(command('codex-coding', 'low').args).toContain('model_reasoning_effort=low');
    expect(command('codex-coding', 'low').args).not.toContain('model_reasoning_effort=xhigh');
    expect(resolveModelAlias('Codex-coding')).toBe('Codex-coding');
  });

  it('replaces the entire built-in alias definition, including its default effort', () => {
    configure({ 'codex-ultra': { model: 'gpt-5.6-luna', reasoning_effort: 'max' } });
    expect(command('codex-ultra').resolvedModel).toBe('gpt-5.6-luna');
    expect(command('codex-ultra').args).toContain('model_reasoning_effort=max');
    configure({ 'codex-ultra': { model: 'gpt-5.4' } });
    expect(command('codex-ultra').args).not.toContain('-c');
    expect(getModelsPayload().aliases.find((a) => a.name === 'codex-ultra')).not.toHaveProperty('defaultReasoningEffort');
  });

  it('chooses the backend from the target model instead of the alias name', () => {
    configure({ 'codex-review': { model: 'opus', reasoning_effort: ' HIGH ' } });
    const cmd = command('codex-review');
    expect(cmd.agent).toBe('claude');
    expect(cmd.args[cmd.args.indexOf('--effort') + 1]).toBe('high');
    expect(cmd.args[cmd.args.indexOf('--model') + 1]).toBe('opus');
  });

  it.each([
    ['fast', 'gemini-2.5-flash', 'gemini', 'gemini-2.5-flash'],
    ['external', 'oc-openai/gpt-5.4', 'opencode', 'openai/gpt-5.4'],
  ])('supports %s aliases for other backends', (name, model, agent, cliModel) => {
    configure({ [name]: { model } });
    const cmd = command(name);
    expect(cmd.agent).toBe(agent);
    expect(cmd.args[cmd.args.indexOf('--model') + 1]).toBe(cliModel);
  });

  it('supports aliases for the Codex CLI default and safe prototype-like names', () => {
    configure({ toString: { model: 'codex', reasoning_effort: 'high' } });
    const cmd = command('toString');
    expect(cmd.agent).toBe('codex');
    expect(cmd.args).not.toContain('--model');
    expect(cmd.args).toContain('model_reasoning_effort=high');
  });

  it('reloads aliases for discovery and execution after editing the file', () => {
    configure({ coding: { model: 'gpt-5.6-terra', reasoning_effort: 'xhigh' } });
    expect(getModelsPayload().aliases).toContainEqual({
      name: 'coding', resolvesTo: 'gpt-5.6-terra', agent: 'codex', defaultReasoningEffort: 'xhigh',
    });
    expect(getModelParameterDescription()).toContain('"coding" (gpt-5.6-terra; auto xhigh reasoning)');
    configure({ coding: { model: 'opus', reasoning_effort: 'max' } });
    expect(getModelsPayload().aliases).toContainEqual({
      name: 'coding', resolvesTo: 'opus', agent: 'claude', defaultReasoningEffort: 'max',
    });
    expect(command('coding').agent).toBe('claude');
    expect(getModelParameterDescription()).toContain('"coding" (opus; auto max reasoning)');
  });
});
