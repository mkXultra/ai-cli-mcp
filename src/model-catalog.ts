export const CLAUDE_MODELS = ['sonnet', 'sonnet[1m]', 'opus', 'opusplan', 'haiku'] as const;
export const CODEX_MODELS = [
  'gpt-5.4',
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

export const MODEL_ALIASES: Record<string, string> = {
  'claude-ultra': 'opus',
  'codex-ultra': 'gpt-5.5',
  'gemini-ultra': 'gemini-3.1-pro-preview',
};

export const MODEL_ALIAS_DETAILS = [
  { name: 'claude-ultra', resolvesTo: 'opus', agent: 'claude', defaultReasoningEffort: 'max' },
  { name: 'codex-ultra', resolvesTo: 'gpt-5.5', agent: 'codex', defaultReasoningEffort: 'xhigh' },
  { name: 'gemini-ultra', resolvesTo: 'gemini-3.1-pro-preview', agent: 'gemini' },
] as const;

export interface DynamicModelBackendDescription {
  explicitPrefix: string;
  explicitPattern: string;
  discoveryCommand: string;
  modelsAreDynamic: boolean;
}

export function getSupportedModelsDescription(): string {
  return [
    '"claude-ultra", "codex-ultra", "gemini-ultra"',
    ...CLAUDE_MODELS.map((model) => `"${model}"`),
    ...CODEX_MODELS.map((model) => `"${model}"`),
    ...GEMINI_MODELS.map((model) => `"${model}"`),
    ...FORGE_MODELS.map((model) => `"${model}"`),
    ...OPENCODE_MODELS.map((model) => `"${model}"`),
    '"oc-<provider/model>"',
  ].join(', ');
}

export function getModelParameterDescription(): string {
  return `The model to use. Aliases: "claude-ultra" (auto max effort), "codex-ultra" (auto xhigh reasoning), "gemini-ultra". Standard: ${[...CLAUDE_MODELS, ...CODEX_MODELS, ...GEMINI_MODELS, ...FORGE_MODELS, ...OPENCODE_MODELS].map((model) => `"${model}"`).join(', ')}. OpenCode also accepts explicit dynamic models using "oc-<provider/model>". "forge" is a provider key, not a Forge model family selector.`;
}

export function getModelsPayload(): {
  aliases: ReadonlyArray<(typeof MODEL_ALIAS_DETAILS)[number]>;
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
    aliases: MODEL_ALIAS_DETAILS,
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
