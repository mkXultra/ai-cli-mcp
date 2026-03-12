export const CLAUDE_MODELS = ['sonnet', 'sonnet[1m]', 'opus', 'opusplan', 'haiku'] as const;
export const CODEX_MODELS = [
  'gpt-5.4',
  'gpt-5.3-codex',
  'gpt-5.2-codex',
  'gpt-5.1-codex-mini',
  'gpt-5.1-codex-max',
  'gpt-5.2',
  'gpt-5.1',
  'gpt-5.1-codex',
  'gpt-5-codex',
  'gpt-5-codex-mini',
  'gpt-5',
] as const;
export const GEMINI_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-3.1-pro-preview',
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
] as const;

export const MODEL_ALIASES: Record<string, string> = {
  'claude-ultra': 'opus',
  'codex-ultra': 'gpt-5.4',
  'gemini-ultra': 'gemini-3.1-pro-preview',
};

export const MODEL_ALIAS_DETAILS = [
  { name: 'claude-ultra', resolvesTo: 'opus', agent: 'claude', defaultReasoningEffort: 'high' },
  { name: 'codex-ultra', resolvesTo: 'gpt-5.4', agent: 'codex', defaultReasoningEffort: 'xhigh' },
  { name: 'gemini-ultra', resolvesTo: 'gemini-3.1-pro-preview', agent: 'gemini' },
] as const;

export function getSupportedModelsDescription(): string {
  return [
    '"claude-ultra", "codex-ultra", "gemini-ultra"',
    ...CLAUDE_MODELS.map((model) => `"${model}"`),
    ...CODEX_MODELS.map((model) => `"${model}"`),
    ...GEMINI_MODELS.map((model) => `"${model}"`),
  ].join(', ');
}

export function getModelParameterDescription(): string {
  return `The model to use. Aliases: "claude-ultra" (auto high effort), "codex-ultra" (auto xhigh reasoning), "gemini-ultra". Standard: ${[...CLAUDE_MODELS, ...CODEX_MODELS, ...GEMINI_MODELS].map((model) => `"${model}"`).join(', ')}.`;
}

export function getModelsPayload(): {
  aliases: ReadonlyArray<(typeof MODEL_ALIAS_DETAILS)[number]>;
  claude: ReadonlyArray<string>;
  codex: ReadonlyArray<string>;
  gemini: ReadonlyArray<string>;
} {
  return {
    aliases: MODEL_ALIAS_DETAILS,
    claude: CLAUDE_MODELS,
    codex: CODEX_MODELS,
    gemini: GEMINI_MODELS,
  };
}
