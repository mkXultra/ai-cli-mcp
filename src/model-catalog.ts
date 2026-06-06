export const CLAUDE_MODELS = ['sonnet', 'sonnet[1m]', 'opus', 'opusplan', 'haiku'] as const;
export const CODEX_MODELS = [
  'gpt-5.4',
  'gpt-5.5',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.2',
] as const;
// Modelos do agente "gemini" servidos pelo Antigravity CLI (agy). O nome de
// exibição (com o nível de raciocínio entre parênteses) É o ID aceito pelo
// --model. Use os aliases lowercase abaixo para conveniência.
export const GEMINI_MODELS = [
  'Gemini 3.5 Flash (High)',
  'Gemini 3.5 Flash (Medium)',
  'Gemini 3.5 Flash (Low)',
  'Gemini 3.1 Pro (High)',
  'Gemini 3.1 Pro (Low)',
] as const;
export const FORGE_MODELS = ['forge'] as const;
export const OPENCODE_MODELS = ['opencode'] as const;

export const MODEL_ALIASES: Record<string, string> = {
  'claude-ultra': 'opus',
  'codex-ultra': 'gpt-5.5',
  // Aliases lowercase -> nome de exibição aceito pelo agy.
  'gemini-ultra': 'Gemini 3.1 Pro (High)',
  'gemini-3.5-flash-high': 'Gemini 3.5 Flash (High)',
  'gemini-3.5-flash': 'Gemini 3.5 Flash (Medium)',
  'gemini-3.5-flash-low': 'Gemini 3.5 Flash (Low)',
  'gemini-3.1-pro': 'Gemini 3.1 Pro (High)',
  'gemini-3.1-pro-low': 'Gemini 3.1 Pro (Low)',
};

export const MODEL_ALIAS_DETAILS = [
  { name: 'claude-ultra', resolvesTo: 'opus', agent: 'claude', defaultReasoningEffort: 'max' },
  { name: 'codex-ultra', resolvesTo: 'gpt-5.5', agent: 'codex', defaultReasoningEffort: 'xhigh' },
  { name: 'gemini-ultra', resolvesTo: 'Gemini 3.1 Pro (High)', agent: 'gemini' },
  { name: 'gemini-3.5-flash-high', resolvesTo: 'Gemini 3.5 Flash (High)', agent: 'gemini' },
  { name: 'gemini-3.5-flash', resolvesTo: 'Gemini 3.5 Flash (Medium)', agent: 'gemini' },
  { name: 'gemini-3.5-flash-low', resolvesTo: 'Gemini 3.5 Flash (Low)', agent: 'gemini' },
  { name: 'gemini-3.1-pro', resolvesTo: 'Gemini 3.1 Pro (High)', agent: 'gemini' },
  { name: 'gemini-3.1-pro-low', resolvesTo: 'Gemini 3.1 Pro (Low)', agent: 'gemini' },
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
