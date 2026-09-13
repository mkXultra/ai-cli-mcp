import { getModelAliases, MODEL_ALIAS_DETAILS } from '../model-catalog.js';
import { loadUserModelAliases, parseUserModelAliases, saveUserModelAliases, serializeUserModelAliases } from '../model-config.js';

export function listAliases() {
  const config = loadUserModelAliases();
  return { configPath: config.path, aliases: getModelAliases(config) };
}

export function addUserAlias(name: string, model: string, reasoning_effort?: string) {
  const config = loadUserModelAliases({ allowMissing: true });
  const existed = config.aliases.has(name);
  config.aliases.set(name, {
    model,
    ...(reasoning_effort !== undefined ? { reasoning_effort } : {}),
  });

  const validated = parseUserModelAliases(serializeUserModelAliases(config.aliases), config.path);
  const alias = getModelAliases(validated).find((entry) => entry.name === name)!;
  // Store the normalized effort reported by model discovery.
  validated.aliases.set(name, {
    model,
    ...(alias.defaultReasoningEffort ? { reasoning_effort: alias.defaultReasoningEffort } : {}),
  });
  saveUserModelAliases(validated);
  return { status: existed ? 'updated' : 'added', configPath: config.path, alias };
}

export function removeUserAlias(name: string) {
  const config = loadUserModelAliases();
  if (!config.aliases.delete(name)) {
    if (MODEL_ALIAS_DETAILS.some((alias) => alias.name === name)) {
      throw new Error(`Alias "${name}" has no user override in ${config.path}. Built-in aliases cannot be removed.`);
    }
    throw new Error(`User alias "${name}" not found in ${config.path}.`);
  }
  const restoredDefault = getModelAliases(config).find((alias) => alias.name === name);
  saveUserModelAliases(config);
  return {
    status: 'removed',
    name,
    configPath: config.path,
    ...(restoredDefault ? { restoredDefault } : {}),
  };
}
