import type { QuestionConfig, Task } from './config.js';

// Kept outside the editable question YAML so evaluation agents cannot weaken the gate.
export const POLICY = Object.freeze({
  version: 'model-set-v2', relatedAt: 0.8, irrelevantAt: 0.2,
  selection: 'Related false excludes; null retains. Require the exact expected candidate set, positive support for every survivor, and no unresolved false conditions.',
});
export type MatchMode = 'and' | 'or';
export const OR_POLICY = Object.freeze({ ...POLICY, version: 'candidate-overlap-v1',
  selection: 'Related false excludes; null retains. Pass when any remaining candidate is expected. Coverage only: positive support and resolved evidence are not required.',
});
export type Relevance = 'related' | 'irrelevant' | 'uncertain';
export type Status = 'pass' | 'wrong' | 'unresolved' | 'no_match' | 'error';
export type TraceStep = {
  question: string; probability: number; relevance: Relevance;
  excluded: string[]; remaining: string[]; supported: string[]; unknown: string[];
};
export type Selection = {
  candidates: string[]; selected: string | null; reason: string;
  resolved: boolean; unsupportedModels: string[];
  trace: TraceStep[]; support: Record<string, string[]>;
  uncertainBlockers: string[]; indistinguishableGroups: string[][];
};
export type Grade = { status: Exclude<Status, 'error'>; expectedEliminatedAt: Record<string, string>;
  firstExpectedLostAt: string | null; allExpectedLostAt: string | null;
  missingModels: string[]; extraModels: string[] };

export function relevance(probability: number): Relevance {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('Invalid Jev probability');
  return probability >= POLICY.relatedAt ? 'related' : probability <= POLICY.irrelevantAt ? 'irrelevant' : 'uncertain';
}

// This function deliberately has no access to benchmark labels or success rates.
export function selectModels(config: QuestionConfig, answers: Record<string, number>): Selection {
  if (Object.keys(answers).length !== Object.keys(config.questions).length ||
      Object.keys(answers).some(k => !Object.hasOwn(config.questions, k))) throw new Error('Incomplete or extra question answers');
  let candidates = [...config.models];
  const trace: TraceStep[] = [];
  const support: Record<string, string[]> = Object.fromEntries(config.models.map(m => [m, []]));
  for (const [id, question] of Object.entries(config.questions)) {
    const state = relevance(answers[id]);
    const excluded = state === 'related' ? candidates.filter(m => question.models[m] === false) : [];
    const supported = state === 'related' ? config.models.filter(m => question.models[m] === true) : [];
    for (const model of supported) support[model].push(id);
    candidates = candidates.filter(m => !excluded.includes(m));
    trace.push({ question: id, probability: answers[id], relevance: state, excluded, remaining: [...candidates],
      supported, unknown: state === 'related' ? config.models.filter(m => question.models[m] === null) : [] });
  }
  const only = candidates.length === 1 ? candidates[0] : null;
  const uncertainBlockers = trace.filter(t => t.relevance === 'uncertain' &&
    candidates.some(m => config.questions[t.question].models[m] === false)).map(t => t.question);
  const unsupportedModels = candidates.filter(m => support[m].length === 0);
  const resolved = candidates.length > 0 && unsupportedModels.length === 0 && uncertainBlockers.length === 0;
  // Compatibility/display convenience only; grading uses the entire candidate set.
  const selected = resolved ? only : null;
  const reason = candidates.length === 0 ? 'All models contradicted by relevant features' :
    unsupportedModels.length > 0 ? 'Remaining models lack positive evidence: ' + unsupportedModels.join(', ') :
    uncertainBlockers.length > 0 ? 'Uncertain features could still exclude remaining models' : 'Supported candidate set resolved';
  const signatures = new Map<string, string[]>();
  const related = trace.filter(t => t.relevance === 'related');
  for (const model of candidates) {
    const key = JSON.stringify(related.map(t => config.questions[t.question].models[model]));
    signatures.set(key, [...(signatures.get(key) ?? []), model]);
  }
  return { candidates, selected, resolved, unsupportedModels, reason, trace, support, uncertainBlockers,
    indistinguishableGroups: [...signatures.values()].filter(g => g.length > 1) };
}

export function gradeSelection(selection: Selection, task: Task, matchMode: MatchMode = 'and'): Grade {
  const expectedEliminatedAt: Record<string, string> = {};
  let firstExpectedLostAt: string | null = null;
  let allExpectedLostAt: string | null = null;
  for (const step of selection.trace) {
    for (const model of step.excluded) if (task.expected_models.includes(model)) {
      expectedEliminatedAt[model] = step.question;
      firstExpectedLostAt ??= step.question;
    }
    if (!allExpectedLostAt && task.expected_models.every(m => !step.remaining.includes(m))) allExpectedLostAt = step.question;
  }
  const missingModels = task.expected_models.filter(m => !selection.candidates.includes(m));
  const extraModels = selection.candidates.filter(m => !task.expected_models.includes(m));
  const status = !selection.candidates.length ? 'no_match' : matchMode === 'or' ?
    (selection.candidates.some(m => task.expected_models.includes(m)) ? 'pass' : 'wrong') :
    missingModels.length || extraModels.length ? 'wrong' : !selection.resolved ? 'unresolved' : 'pass';
  return { status, expectedEliminatedAt, firstExpectedLostAt, allExpectedLostAt, missingModels, extraModels };
}
