import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { hash, type Inputs, type Task } from './config.js';
import { POLICY, OR_POLICY, selectModels, gradeSelection, type Selection, type Grade, type Status, type MatchMode } from './selection.js';
import { validateResult, type Provider, type JevRequest } from './provider.js';

const REQUEST_FORMAT = 'task-feature-noul-v1';
const reportSchema = z.object({
  matchMode: z.enum(['and', 'or']).default('and'),
  format: z.literal(1), engineFingerprint: z.string(), provider: z.object({ id: z.string(), version: z.string() }),
  models: z.array(z.string()), tasks: z.array(z.object({ id: z.string(), taskFingerprint: z.string(),
    status: z.enum(['pass', 'wrong', 'unresolved', 'no_match', 'error']) }).passthrough()),
}).passthrough();

export type TaskResult = {
  id: string; taskFingerprint: string; expected_models: string[]; status: Status;
  selection?: Selection; grade?: Grade; error?: string;
  answers: Record<string, number>; cache: Record<string, { key: string; source: 'cache' | 'api' }>;
};
export type Difference = { id: string; change: 'fixed' | 'regressed' | 'changed' | 'unchanged' | 'added' | 'removed' | 'incomparable';
  before?: Status; after?: Status };
export type Report = {
  format: 1; engineFingerprint: string; matchMode: MatchMode; policy: typeof POLICY | typeof OR_POLICY; provider: { id: string; version: string };
  models: string[]; startedAt: string; finishedAt: string; questionsHash: string; benchHash: string;
  totals: Record<Status, number> & { total: number }; allPassed: boolean;
  usage: { apiBatches: number; cachedAnswers: number; newAnswers: number };
  tasks: TaskResult[]; differences: Difference[];
  collisions: { tasks: string[]; expected: Record<string, string[]> }[];
};

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

export async function engineFingerprint(): Promise<string> {
  const current = fileURLToPath(import.meta.url);
  const suffix = current.endsWith('.ts') ? '.ts' : '.js';
  const sources = await Promise.all(['config', 'selection', 'provider', 'engine', 'cli'].map(name =>
    readFile(join(dirname(current), name + suffix), 'utf8')));
  return hash(sources);
}

export function answerKey(instructions: string, question: string, provider: Pick<Provider, 'id' | 'version'>): string {
  // Model profiles, expected labels, task IDs and question IDs do not change the actual inference.
  return hash({ format: REQUEST_FORMAT, provider: provider.id, version: provider.version, instructions, question });
}

async function cachedAnswer(directory: string, key: string, provider: Provider): Promise<number | undefined> {
  let source: string;
  try { source = await readFile(join(directory, `${key}.json`), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  try {
    const record = JSON.parse(source);
    if (record.key !== key || record.format !== REQUEST_FORMAT || record.provider !== provider.id || record.model !== provider.version ||
        typeof record.probability !== 'number' || !Number.isFinite(record.probability) || record.probability < 0 || record.probability > 1) throw new Error();
    return record.probability;
  } catch { throw new Error(`Invalid cache entry ${key}; remove that file and rerun`); }
}

function taskFingerprint(task: Task): string {
  return hash({ instructions: task.instructions, expected_models: [...task.expected_models].sort() });
}

function differences(previous: z.infer<typeof reportSchema> | undefined, tasks: TaskResult[]): Difference[] {
  if (!previous) return [];
  const before = new Map(previous.tasks.map(t => [t.id, t]));
  const result: Difference[] = tasks.map(task => {
    const old = before.get(task.id); before.delete(task.id);
    const change = !old ? 'added' : old.taskFingerprint !== task.taskFingerprint ? 'incomparable' :
      old.status === task.status ? 'unchanged' : task.status === 'pass' ? 'fixed' : old.status === 'pass' ? 'regressed' : 'changed';
    return { id: task.id, change, before: old?.status, after: task.status };
  });
  for (const task of before.values()) result.push({ id: task.id, change: 'removed', before: task.status });
  return result;
}

function findCollisions(tasks: TaskResult[]): Report['collisions'] {
  const groups = new Map<string, TaskResult[]>();
  for (const task of tasks) {
    if (!task.selection) continue;
    const key = JSON.stringify(task.selection.trace.map(t => [t.question, t.relevance]));
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  return [...groups.values()].filter(group => group.length > 1 &&
    group.some(t => JSON.stringify([...t.expected_models].sort()) !== JSON.stringify([...group[0].expected_models].sort())))
    .map(group => ({ tasks: group.map(t => t.id), expected: Object.fromEntries(group.map(t => [t.id, t.expected_models])) }));
}

const cell = (value: string) => value.replaceAll('|', '\\|').replaceAll('\n', ' ');
export function markdown(report: Report): string {
  const lines = ['# Model selection evaluation', '',
    `Grading: ${report.matchMode.toUpperCase()}. ${report.policy.selection}`, '',
    `${report.totals.pass}/${report.totals.total} PASS; ${report.allPassed ? 'all passed' : 'not all passed'}.`, '',
    `Jev batches: ${report.usage.apiBatches}; new answers: ${report.usage.newAnswers}; cached answers: ${report.usage.cachedAnswers}.`, '',
    '| Task | Status | Expected set | Candidate set | Missing | Extra | First expected loss |',
    '|---|---|---|---|---|---|---|'];
  for (const t of report.tasks) lines.push(`| ${cell(t.id)} | ${t.status} | ${cell(t.expected_models.join(', '))} | ${cell(t.selection?.candidates.join(', ') ?? '—')} | ${cell(t.grade?.missingModels.join(', ') ?? '—')} | ${cell(t.grade?.extraModels.join(', ') ?? '—')} | ${cell(t.grade?.firstExpectedLostAt ?? '—')} |`);
  for (const t of report.tasks.filter(t => t.status !== 'pass')) {
    lines.push('', `## ${t.id}`, '', t.error ?? t.selection!.reason, '');
    if (t.selection) {
      if (t.grade?.missingModels.length) lines.push(`Missing expected models: ${t.grade.missingModels.join(', ')}`, '');
      if (t.grade?.extraModels.length) lines.push(`Unexpected models: ${t.grade.extraModels.join(', ')}`, '');
      lines.push('| Question | P(yes) | Relevance | Excluded | Remaining |', '|---|---:|---|---|---|');
      for (const s of t.selection.trace) lines.push(`| ${cell(s.question)} | ${s.probability.toFixed(3)} | ${s.relevance} | ${cell(s.excluded.join(', '))} | ${cell(s.remaining.join(', '))} |`);
      if (t.selection.uncertainBlockers.length) lines.push('', `Uncertain blockers: ${t.selection.uncertainBlockers.join(', ')}`);
      if (t.selection.indistinguishableGroups.length) lines.push('', `Indistinguishable profiles: ${JSON.stringify(t.selection.indistinguishableGroups)}`);
    }
  }
  if (report.differences.length) {
    lines.push('', '## Changes since previous report', '', '| Task | Change | Before | After |', '|---|---|---|---|');
    for (const d of report.differences) lines.push(`| ${cell(d.id)} | ${d.change} | ${d.before ?? '—'} | ${d.after ?? '—'} |`);
  }
  if (report.collisions.length) {
    lines.push('', '## Same answers, different expected sets', '');
    if (report.matchMode === 'or') lines.push('Different expected sets are diagnostic only: one candidate set may overlap several expected sets.', '');
    for (const c of report.collisions) lines.push(`- ${c.tasks.join(', ')}: ${JSON.stringify(c.expected)}`);
  }
  lines.push('', 'PASS measures agreement with imported labels, not execution of a coding task. See inputs.json and report.json for exact inputs, probabilities, policy and traces.', '');
  return lines.join('\n');
}

export async function evaluate(inputs: Inputs, options: {
  provider: Provider; output: string; cache: string; offline?: boolean; refresh?: boolean;
  batchSize?: number; previous?: string; matchMode?: MatchMode; progress?: (message: string) => void;
}): Promise<Report> {
  const matchMode = options.matchMode ?? 'and';
  if (matchMode !== 'and' && matchMode !== 'or') throw new Error('match-mode must be and or or');
  const batchSize = options.batchSize ?? 64;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 256) throw new Error('batch-size must be an integer from 1 to 256');
  if (options.offline && options.refresh) throw new Error('--offline and --refresh cannot be combined');
  if (!inputs.tasks.length) throw new Error('No selected tasks');
  const fingerprint = await engineFingerprint();
  const provider = options.provider;
  const previous = options.previous ? reportSchema.parse(JSON.parse(await readFile(options.previous, 'utf8'))) : undefined;
  if (previous && previous.matchMode !== matchMode) throw new Error('Previous report uses a different match mode; cannot compare');
  if (previous && (previous.engineFingerprint !== fingerprint || previous.provider.id !== provider.id || previous.provider.version !== provider.version ||
      JSON.stringify([...previous.models].sort()) !== JSON.stringify([...inputs.config.models].sort()))) {
    throw new Error('Previous report uses a different engine, provider version, or model catalog; cannot compare');
  }
  // Never overwrite a run. Fail before spending API calls if the destination exists.
  await mkdir(dirname(options.output), { recursive: true });
  await mkdir(options.output, { mode: 0o700 });
  await writeJson(join(options.output, 'inputs.json'), inputs);
  const report: Report = { format: 1, engineFingerprint: fingerprint, matchMode, policy: matchMode === 'or' ? OR_POLICY : POLICY,
    provider: { id: provider.id, version: provider.version }, models: inputs.config.models,
    startedAt: new Date().toISOString(), finishedAt: '', questionsHash: hash(inputs.config), benchHash: hash(inputs.tasks),
    totals: { total: 0, pass: 0, wrong: 0, unresolved: 0, no_match: 0, error: 0 }, allPassed: false,
    usage: { apiBatches: 0, cachedAnswers: 0, newAnswers: 0 }, tasks: [], differences: [], collisions: [] };
  for (const task of inputs.tasks) {
    const result: TaskResult = { id: task.id, taskFingerprint: taskFingerprint(task), expected_models: task.expected_models,
      status: 'error', answers: {}, cache: {} };
    try {
      const missing = new Map<string, { text: string; ids: string[] }>();
      for (const [id, q] of Object.entries(inputs.config.questions)) {
        const key = answerKey(task.instructions, q.text, provider);
        const value = options.refresh ? undefined : await cachedAnswer(options.cache, key, provider);
        if (value === undefined) {
          const pending = missing.get(key) ?? { text: q.text, ids: [] }; pending.ids.push(id); missing.set(key, pending);
        } else {
          result.answers[id] = value; result.cache[id] = { key, source: 'cache' }; report.usage.cachedAnswers++;
        }
      }
      if (options.offline && missing.size) throw new Error(`Offline cache miss: ${[...missing.values()].flatMap(q => q.ids).join(', ')}`);
      const pending = [...missing];
      for (let offset = 0; offset < pending.length; offset += batchSize) {
        const batch = pending.slice(offset, offset + batchSize);
        const request: JevRequest = { state: { instructions: task.instructions }, questions: Object.fromEntries(
          batch.map(([key, q]) => [`q_${key}`, { type: 'noul' as const, instructions: q.text }])) };
        options.progress?.(`${task.id}: asking ${batch.length} questions (${offset + batch.length}/${pending.length} uncached)`);
        report.usage.apiBatches++;
        const batchFile = join(options.output, 'batches', `${report.usage.apiBatches}.json`);
        await writeJson(batchFile, { task: task.id, provider: report.provider, request });
        const response = validateResult(await provider.evaluate(request), request, provider.version);
        await writeJson(batchFile, { task: task.id, provider: report.provider, request, response });
        for (const [key, q] of batch) {
          const probability = response.answers[`q_${key}`].noul;
          await writeJson(join(options.cache, `${key}.json`), { format: REQUEST_FORMAT, key, provider: provider.id,
            model: provider.version, probability });
          for (const id of q.ids) { result.answers[id] = probability; result.cache[id] = { key, source: 'api' }; }
          report.usage.newAnswers++;
        }
      }
      result.selection = selectModels(inputs.config, result.answers);
      result.grade = gradeSelection(result.selection, task, matchMode); result.status = result.grade.status;
    } catch (error) { result.error = error instanceof Error ? error.message : 'Evaluation failed'; }
    report.tasks.push(result); report.totals.total++; report.totals[result.status]++;
    options.progress?.(`${task.id}: ${result.status.toUpperCase()} ${result.selection?.selected ?? result.selection?.candidates.join(', ') ?? result.error}`);
    // Checkpoint completed tasks even if a later request fails or the process is interrupted.
    await writeJson(join(options.output, 'progress.json'), { completed: report.tasks, usage: report.usage });
  }
  report.finishedAt = new Date().toISOString(); report.allPassed = report.totals.pass === report.totals.total;
  report.differences = differences(previous, report.tasks); report.collisions = findCollisions(report.tasks);
  await writeJson(join(options.output, 'report.json'), report);
  await writeFile(join(options.output, 'report.md'), markdown(report), { mode: 0o600 });
  return report;
}
