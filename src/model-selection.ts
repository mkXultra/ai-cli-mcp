export const ALLOWED_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const CLAUDE_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const CODEX_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);
const CODEX_MAX_REASONING_MODELS = new Set(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
const CODEX_ULTRA_REASONING_MODELS = new Set(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra']);
const OPENCODE_MODEL_ERROR = 'Invalid OpenCode model. Expected exact syntax oc-<provider/model>.';

export type Agent = 'codex' | 'claude' | 'gemini' | 'forge' | 'opencode';

export interface ModelSelection {
  agent: Agent;
  resolvedModel: string;
  openCodeModel: string | null;
}

function getStandardAgentForModel(model: string): Exclude<Agent, 'opencode'> {
  if (model === 'forge') {
    return 'forge';
  }
  if (model === 'codex') {
    return 'codex';
  }
  if (model.startsWith('gpt-')) {
    return 'codex';
  }
  if (model.startsWith('gemini')) {
    return 'gemini';
  }
  return 'claude';
}

function isPotentialOpenCodeExplicitModel(rawModel: string): boolean {
  return rawModel.startsWith('oc-') || rawModel.trim().startsWith('oc-');
}

function extractOpenCodeModel(rawModel: string): string {
  if (rawModel !== rawModel.trim()) {
    throw new Error(OPENCODE_MODEL_ERROR);
  }

  if (!rawModel.startsWith('oc-')) {
    throw new Error(OPENCODE_MODEL_ERROR);
  }

  const remainder = rawModel.slice(3);
  const slashIndex = remainder.indexOf('/');
  if (slashIndex === -1) {
    throw new Error(OPENCODE_MODEL_ERROR);
  }

  const provider = remainder.slice(0, slashIndex);
  const model = remainder.slice(slashIndex + 1);
  if (!provider || !model) {
    throw new Error(OPENCODE_MODEL_ERROR);
  }

  return remainder;
}

export function resolveModelSelection(rawModel: string): ModelSelection {
  if (rawModel === 'opencode') {
    return {
      agent: 'opencode',
      resolvedModel: rawModel,
      openCodeModel: null,
    };
  }

  if (isPotentialOpenCodeExplicitModel(rawModel)) {
    return {
      agent: 'opencode',
      resolvedModel: rawModel,
      openCodeModel: extractOpenCodeModel(rawModel),
    };
  }

  const resolvedModel = rawModel;
  return {
    agent: getStandardAgentForModel(resolvedModel),
    resolvedModel,
    openCodeModel: null,
  };
}

export function getReasoningEffort(model: string, rawValue: unknown): string {
  if (typeof rawValue !== 'string') {
    return '';
  }
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return '';
  }

  if (model === 'opencode' || model.startsWith('oc-')) {
    throw new Error('reasoning_effort is not supported for opencode.');
  }

  const normalized = trimmed.toLowerCase();
  if (!ALLOWED_REASONING_EFFORTS.has(normalized)) {
    throw new Error(
      `Invalid reasoning_effort: ${rawValue}. Allowed values: low, medium, high, xhigh, max, ultra.`
    );
  }
  const agent = getStandardAgentForModel(model);
  if (agent === 'forge') {
    throw new Error('reasoning_effort is not supported for forge.');
  }
  if (agent === 'gemini') {
    throw new Error(
      'reasoning_effort is only supported for Claude and Codex models.'
    );
  }
  if (agent === 'claude' && !CLAUDE_REASONING_EFFORTS.has(normalized)) {
    throw new Error(
      'Claude reasoning_effort supports only low, medium, high, xhigh, max.'
    );
  }
  if (agent === 'codex') {
    const supportedEfforts = new Set(CODEX_REASONING_EFFORTS);
    if (CODEX_MAX_REASONING_MODELS.has(model)) {
      supportedEfforts.add('max');
    }
    if (CODEX_ULTRA_REASONING_MODELS.has(model)) {
      supportedEfforts.add('ultra');
    }
    if (supportedEfforts.has(normalized)) {
      return normalized;
    }
    throw new Error(
      `Codex reasoning_effort for ${model} supports only ${[...supportedEfforts].join(', ')}.`
    );
  }
  return normalized;
}
