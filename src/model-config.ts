import { randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

export interface UserModelAlias {
  model: string;
  reasoning_effort?: string;
}

export interface UserModelConfig {
  path: string;
  aliases: Map<string, UserModelAlias>;
}

export function getUserConfigPath(): string {
  if (process.env.AI_CLI_CONFIG_PATH) {
    return resolve(process.env.AI_CLI_CONFIG_PATH);
  }
  const configHome = process.env.XDG_CONFIG_HOME;
  return join(configHome && isAbsolute(configHome) ? configHome : join(homedir(), '.config'), 'ai-cli', 'config.json');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function loadUserModelAliases(options: { allowMissing?: boolean } = {}): UserModelConfig {
  const path = getUserConfigPath();
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch (error: any) {
    if (error.code === 'ENOENT' && (options.allowMissing || !process.env.AI_CLI_CONFIG_PATH)) {
      return { path, aliases: new Map() };
    }
    throw new Error(`Cannot read AI CLI config ${path}: ${error.message}`);
  }

  return parseUserModelAliases(contents, path);
}

export function parseUserModelAliases(contents: string, path: string): UserModelConfig {
  let config: unknown;
  try {
    config = JSON.parse(contents);
  } catch {
    throw new Error(`Invalid AI CLI config ${path}: expected valid JSON.`);
  }

  const invalid = (message: string): never => {
    throw new Error(`Invalid AI CLI config ${path}: ${message}`);
  };
  if (!isObject(config)) {
    return invalid('expected an object.');
  }
  if (Object.keys(config).some((key) => key !== 'model_aliases')) {
    return invalid('the only supported setting is "model_aliases".');
  }
  if (!Object.hasOwn(config, 'model_aliases')) {
    return { path, aliases: new Map() };
  }
  if (!isObject(config.model_aliases)) {
    return invalid('"model_aliases" must be an object.');
  }

  const aliases = new Map<string, UserModelAlias>();
  for (const [name, value] of Object.entries(config.model_aliases)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name) || name.startsWith('oc-')) {
      return invalid(`alias "${name}" must start with a letter, contain only letters, digits, "_" or "-", and must not use the reserved "oc-" prefix.`);
    }
    if (!isObject(value) || typeof value.model !== 'string' || !value.model || /\s/.test(value.model)) {
      return invalid(`alias "${name}" must contain a nonempty "model" without whitespace.`);
    }
    if (Object.keys(value).some((key) => !['model', 'reasoning_effort'].includes(key))) {
      return invalid(`alias "${name}" supports only "model" and "reasoning_effort".`);
    }
    const hasEffort = Object.hasOwn(value, 'reasoning_effort');
    if (hasEffort && (typeof value.reasoning_effort !== 'string' || !value.reasoning_effort.trim())) {
      return invalid(`alias "${name}" must use a nonempty string for "reasoning_effort".`);
    }
    aliases.set(name, {
      model: value.model,
      ...(hasEffort ? { reasoning_effort: value.reasoning_effort as string } : {}),
    });
  }
  return { path, aliases };
}

export function serializeUserModelAliases(aliases: Map<string, UserModelAlias>): string {
  return `${JSON.stringify({ model_aliases: Object.fromEntries(aliases) }, null, 2)}\n`;
}

export function saveUserModelAliases(config: UserModelConfig): void {
  const contents = serializeUserModelAliases(config.aliases);
  // Validate before creating directories or replacing an existing file.
  parseUserModelAliases(contents, config.path);
  let temporaryPath: string | undefined;
  try {
    let target = config.path;
    let mode = 0o600;
    let existing = false;
    try {
      lstatSync(target);
      existing = true;
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (existing) {
      // Keep symlinked dotfiles linked and update their target instead.
      target = realpathSync(target);
      mode = statSync(target).mode & 0o777;
    }
    mkdirSync(dirname(target), { recursive: true });
    temporaryPath = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
    writeFileSync(temporaryPath, contents, { encoding: 'utf8', flag: 'wx', mode });
    chmodSync(temporaryPath, mode);
    renameSync(temporaryPath, target);
  } catch (error: any) {
    throw new Error(`Cannot write AI CLI config ${config.path}: ${error.message}`);
  } finally {
    if (temporaryPath) rmSync(temporaryPath, { force: true });
  }
}
