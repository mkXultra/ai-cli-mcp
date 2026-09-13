import { loadUserModelAliases } from './model-config.js';
import { getReasoningEffort, resolveModelSelection, type Agent } from './model-selection.js';

export const CLAUDE_MODELS = ['sonnet', 'sonnet[1m]', 'opus', 'opusplan', 'fable', 'haiku'] as const;
export const CODEX_MODELS = [
  'gpt-6-astra',
  'gpt-5.4',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.2',
] as const;
export const GEMINI_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-3.1-pro-preview',
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
] as const;
export const FORGE_MODELS = ['forge'] as const;
export const OPENCODE_MODELS = ['opencode'] as const;

export interface ModelAliasDetails {
  name: string;
  resolvesTo: string;
  agent: Agent;
  defaultReasoningEffort?: string;
}

export const MODEL_ALIAS_DETAILS: readonly ModelAliasDetails[] = [
  { name: 'claude-ultra', resolvesTo: 'opus', agent: 'claude', defaultReasoningEffort: 'max' },
  { name: 'codex-ultra', resolvesTo: 'gpt-6-astra', agent: 'codex', defaultReasoningEffort: 'ultra' },
  { name: 'gemini-ultra', resolvesTo: 'gemini-3.1-pro-preview', agent: 'gemini' },
] as const;

export const MODEL_ALIASES: Record<string, string> = Object.fromEntries(
  MODEL_ALIAS_DETAILS.map((alias) => [alias.name, alias.resolvesTo]),
);

export function getModelAliases(config = loadUserModelAliases()): ModelAliasDetails[] {
  const aliases = new Map(MODEL_ALIAS_DETAILS.map((alias) => [alias.name, alias]));
  const nativeModels = new Set<string>([
    'codex', ...CLAUDE_MODELS, ...CODEX_MODELS, ...GEMINI_MODELS, ...FORGE_MODELS, ...OPENCODE_MODELS,
  ]);

  for (const [name, value] of config.aliases) {
    try {
      if (nativeModels.has(name)) {
        throw new Error('alias names cannot replace native model names.');
      }
      if (aliases.has(value.model) || config.aliases.has(value.model)) {
        throw new Error(`use a native model instead of alias "${value.model}"; alias chaining is not supported.`);
      }
      const { agent } = resolveModelSelection(value.model);
      const effort = getReasoningEffort(value.model, value.reasoning_effort);
      aliases.set(name, {
        name,
        resolvesTo: value.model,
        agent,
        ...(effort ? { defaultReasoningEffort: effort } : {}),
      });
    } catch (error: any) {
      throw new Error(`Invalid model alias "${name}" in ${config.path}: ${error.message}`);
    }
  }

  return [...aliases.values()];
}

export interface DynamicModelBackendDescription {
  explicitPrefix: string;
  explicitPattern: string;
  discoveryCommand: string;
  modelsAreDynamic: boolean;
}

export function getSupportedModelsDescription(): string {
  return [
    ...getModelAliases().map((alias) => `"${alias.name}"`),
    ...CLAUDE_MODELS.map((model) => `"${model}"`),
    ...CODEX_MODELS.map((model) => `"${model}"`),
    ...GEMINI_MODELS.map((model) => `"${model}"`),
    ...FORGE_MODELS.map((model) => `"${model}"`),
    ...OPENCODE_MODELS.map((model) => `"${model}"`),
    '"oc-<provider/model>"',
  ].join(', ');
}

export function getModelParameterDescription(): string {
  const aliases = getModelAliases().map((alias) =>
    `"${alias.name}" (${alias.resolvesTo}${alias.defaultReasoningEffort ? `; auto ${alias.defaultReasoningEffort} reasoning` : ''})`
  ).join(', ');
  return `The model to use. Aliases (including user config): ${aliases}. An explicit reasoning_effort overrides the alias default. Standard: ${[...CLAUDE_MODELS, ...CODEX_MODELS, ...GEMINI_MODELS, ...FORGE_MODELS, ...OPENCODE_MODELS].map((model) => `"${model}"`).join(', ')}. Fable may require usage credits. OpenCode also accepts explicit dynamic models using "oc-<provider/model>". "forge" is a provider key, not a Forge model family selector.`;
}

export function getModelsPayload(): {
  aliases: ReadonlyArray<ModelAliasDetails>;
  claude: ReadonlyArray<string>;
  codex: ReadonlyArray<string>;
  gemini: ReadonlyArray<string>;
  forge: ReadonlyArray<string>;
  opencode: ReadonlyArray<string>;
  dynamicModelBackends: {
    opencode: DynamicModelBackendDescription;
  };
} {
  return {
    aliases: getModelAliases(),
    claude: CLAUDE_MODELS,
    codex: CODEX_MODELS,
    gemini: GEMINI_MODELS,
    forge: FORGE_MODELS,
    opencode: OPENCODE_MODELS,
    dynamicModelBackends: {
      opencode: {
        explicitPrefix: 'oc-',
        explicitPattern: 'oc-<provider/model>',
        discoveryCommand: 'opencode models',
        modelsAreDynamic: true,
      },
    },
  };
}
