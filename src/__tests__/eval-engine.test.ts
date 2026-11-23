import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';
import { hash, loadInputs, parseQuestions, parseYaml, type Inputs, type QuestionConfig } from '../eval-engine/config.js';
import { POLICY, gradeSelection, relevance, selectModels } from '../eval-engine/selection.js';
import { answerKey, evaluate, type Report } from '../eval-engine/engine.js';
import { cloudflareProvider, validateResult, type JevRequest, type Provider } from '../eval-engine/provider.js';
import { runEvalCli } from '../eval-engine/cli.js';

const folders: string[] = [];
async function temporary() { const p = await mkdtemp(join(tmpdir(), 'acm-eval-')); folders.push(p); return p; }
afterEach(async () => { await Promise.all(folders.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
const config = (): QuestionConfig => ({ version: 1, models: ['a', 'b'], questions: {
  parsing: { text: 'Does the task require parsing?', models: { a: true, b: false } },
} });
const inputs = (): Inputs => ({ config: config(), tasks: [{ id: 't', instructions: 'Parse an expression.', expected_models: ['a'] }] });
function provider(probability: number | ((q: string, task: string) => number) = 1) {
  return { id: 'test-jev', version: 'jev-test', evaluate: vi.fn(async (request: JevRequest) => ({
    model: 'jev-test', answers: Object.fromEntries(Object.entries(request.questions).map(([k, q]) => [k, {
      type: 'noul' as const, noul: typeof probability === 'number' ? probability : probability(q.instructions, request.state.instructions),
    }])),
  })) } satisfies Provider;
}

describe('evaluation configuration', () => {
  it('loads inline and bench-relative file tasks, strict booleans and null', async () => {
    const p = await temporary(); await writeFile(join(p, 'task.md'), 'Parse external text.');
    const c = config(); c.questions.parsing.models.b = null;
    await writeFile(join(p, 'question.yaml'), stringify(c));
    await writeFile(join(p, 'bench.yaml'), stringify({ tasks: [
      inputs().tasks[0], { id: 'file-task', instructions_file: 'task.md', expected_models: ['a', 'b'] },
    ] }));
    const loaded = await loadInputs(join(p, 'question.yaml'), join(p, 'bench.yaml'));
    expect(loaded.config.questions.parsing.models.b).toBeNull();
    expect(loaded.tasks[1].instructions).toBe('Parse external text.');
  });

  it.each([
    ['quoted boolean', (c: any) => { c.questions.parsing.models.a = 'true'; }],
    ['missing model', (c: any) => { delete c.questions.parsing.models.b; }],
    ['extra model', (c: any) => { c.questions.parsing.models.c = true; }],
    ['duplicate catalog', (c: any) => { c.models.push('a'); }],
    ['empty questions', (c: any) => { c.questions = {}; }],
    ['blank question', (c: any) => { c.questions.parsing.text = ' '; }],
    ['editable pass threshold', (c: any) => { c.threshold = .1; }],
    ['unexpected field', (c: any) => { c.questions.parsing.weight = 999; }],
  ])('rejects %s', (_, mutate) => { const c = config(); mutate(c); expect(() => parseQuestions(c)).toThrow(); });

  it('rejects duplicate YAML keys, multiple documents, aliases and custom tags', () => {
    for (const source of ['x: 1\nx: 2', 'x: 1\n---\ny: 2', 'x: &x [1]\ny: *x', 'x: !magic 1']) {
      expect(() => parseYaml(source, 'test.yaml')).toThrow();
    }
  });

  it.each([
    ['both instruction forms', { ...inputs().tasks[0], instructions_file: 'task.md' }],
    ['missing instructions', { id: 't', expected_models: ['a'] }],
    ['unknown expected model', { ...inputs().tasks[0], expected_models: ['c'] }],
    ['empty expected set', { ...inputs().tasks[0], expected_models: [] }],
    ['missing instruction file', { id: 't', instructions_file: 'missing.md', expected_models: ['a'] }],
  ])('rejects %s in benchmark', async (_, task) => {
    const p = await temporary(); await writeFile(join(p, 'q.yaml'), stringify(config()));
    await writeFile(join(p, 'b.yaml'), stringify({ tasks: [task] }));
    await expect(loadInputs(join(p, 'q.yaml'), join(p, 'b.yaml'))).rejects.toThrow();
  });

  it('rejects duplicate benchmark IDs', async () => {
    const p = await temporary(); await writeFile(join(p, 'q.yaml'), stringify(config()));
    await writeFile(join(p, 'b.yaml'), stringify({ tasks: [inputs().tasks[0], inputs().tasks[0]] }));
    await expect(loadInputs(join(p, 'q.yaml'), join(p, 'b.yaml'))).rejects.toThrow(/Duplicate task/);
  });
});

describe('fixed model filtering and grading', () => {
  it('OR accepts subsets and supersets but rejects disjoint or empty candidates', () => {
    const one = selectModels(config(), { parsing: 1 });
    const bothExpected = { ...inputs().tasks[0], expected_models: ['a', 'b'] };
    expect(gradeSelection(one, bothExpected, 'or').status).toBe('pass');
    expect(gradeSelection(one, bothExpected).status).toBe('wrong');
    expect(gradeSelection(one, { ...bothExpected, expected_models: ['b'] }, 'or').status).toBe('wrong');
    const c = config(); c.questions.parsing.models.b = true;
    expect(gradeSelection(selectModels(c, { parsing: 1 }), inputs().tasks[0], 'or').status).toBe('pass');
    c.questions.parsing.models = { a: false, b: false };
    expect(gradeSelection(selectModels(c, { parsing: 1 }), bothExpected, 'or').status).toBe('no_match');
  });

  it('OR measures raw coverage while preserving unsupported and uncertain evidence diagnostics', () => {
    const sel = selectModels(config(), { parsing: .5 });
    const task = { ...inputs().tasks[0], expected_models: ['a', 'b'] };
    expect(sel.resolved).toBe(false);
    expect(sel.unsupportedModels).toEqual(['a', 'b']);
    expect(sel.uncertainBlockers).toEqual(['parsing']);
    expect(gradeSelection(sel, task, 'or').status).toBe('pass');
    expect(gradeSelection(sel, task).status).toBe('unresolved');
  });
  it('uses related true/false evidence and rejects a strict subset of expected models', () => {
    const selection = selectModels(config(), { parsing: .9 });
    expect(selection.selected).toBe('a');
    expect(selection.trace[0].excluded).toEqual(['b']);
    expect(gradeSelection(selection, inputs().tasks[0]).status).toBe('pass');
    expect(gradeSelection(selection, { ...inputs().tasks[0], expected_models: ['a', 'b'] })).toMatchObject({
      status: 'wrong', missingModels: ['b'], extraModels: [], firstExpectedLostAt: 'parsing',
    });
    expect(gradeSelection(selection, { ...inputs().tasks[0], expected_models: ['b'] })).toMatchObject({
      status: 'wrong', expectedEliminatedAt: { b: 'parsing' }, allExpectedLostAt: 'parsing',
    });
  });

  it('ignores irrelevant questions completely and does not choose by model order', () => {
    const c = config(); c.questions.irrelevant = { text: 'Unrelated?', models: { a: false, b: true } };
    expect(selectModels(c, { parsing: 1, irrelevant: 0 }).selected).toBe('a');
    c.models.reverse(); expect(selectModels(c, { parsing: 1, irrelevant: 0 }).selected).toBe('a');
    expect(selectModels(config(), { parsing: 0 }).selected).toBeNull();
  });

  it('retains null but requires positive support for every member even when the set matches', () => {
    const c = config(); c.questions.parsing.models.b = null;
    const sel = selectModels(c, { parsing: 1 });
    expect(sel.candidates).toEqual(['a', 'b']); expect(sel.selected).toBeNull();
    expect(gradeSelection(sel, { ...inputs().tasks[0], expected_models: ['a', 'b'] }).status).toBe('unresolved');
    expect(sel.unsupportedModels).toEqual(['b']);
  });

  it('passes a fully supported exact multi-model set regardless of ordering', () => {
    const c = config(); c.questions.parsing.models.b = true;
    const sel = selectModels(c, { parsing: 1 });
    expect(sel.resolved).toBe(true); expect(sel.selected).toBeNull();
    expect(gradeSelection(sel, { ...inputs().tasks[0], expected_models: ['b', 'a'] })).toMatchObject({
      status: 'pass', missingModels: [], extraModels: [], firstExpectedLostAt: null,
    });
    c.models.reverse();
    expect(gradeSelection(selectModels(c, { parsing: 1 }), { ...inputs().tasks[0], expected_models: ['a', 'b'] }).status).toBe('pass');
  });

  it('rejects a superset or partially overlapping set instead of merely checking all expected models are present', () => {
    const c = config(); c.questions.parsing.models.b = true;
    const sel = selectModels(c, { parsing: 1 });
    expect(gradeSelection(sel, inputs().tasks[0])).toMatchObject({ status: 'wrong', missingModels: [], extraModels: ['b'] });
    c.models.push('c'); c.questions.parsing.models.c = false;
    expect(gradeSelection(selectModels(c, { parsing: 1 }), { ...inputs().tasks[0], expected_models: ['a', 'c'] })).toMatchObject({
      status: 'wrong', missingModels: ['c'], extraModels: ['b'], firstExpectedLostAt: 'parsing',
    });
  });

  it('does not resolve an exact set when any member has an uncertain exclusion', () => {
    const c = config(); c.questions.parsing.models.b = true;
    c.questions.other = { text: 'Other?', models: { a: true, b: false } };
    const sel = selectModels(c, { parsing: 1, other: .5 });
    expect(sel.uncertainBlockers).toEqual(['other']);
    expect(gradeSelection(sel, { ...inputs().tasks[0], expected_models: ['a', 'b'] }).status).toBe('unresolved');
  });

  it('reports contradictory profiles, and the first point all acceptable models are lost', () => {
    const c = config(); c.questions.other = { text: 'Other?', models: { a: false, b: true } };
    const sel = selectModels(c, { parsing: 1, other: 1 });
    expect(sel.candidates).toEqual([]);
    expect(gradeSelection(sel, { ...inputs().tasks[0], expected_models: ['a', 'b'] })).toMatchObject({
      status: 'no_match', firstExpectedLostAt: 'parsing', allExpectedLostAt: 'other', expectedEliminatedAt: { a: 'other', b: 'parsing' },
      missingModels: ['a', 'b'], extraModels: [],
    });
  });

  it('requires positive evidence even for a sole surviving model', () => {
    const c = config(); c.questions.parsing.models.a = null;
    const sel = selectModels(c, { parsing: 1 }); expect(sel.candidates).toEqual(['a']); expect(sel.selected).toBeNull();
  });

  it('keeps uncertain exclusions from producing false passes', () => {
    const c = config(); c.questions.other = { text: 'Other?', models: { a: false, b: true } };
    const sel = selectModels(c, { parsing: 1, other: .5 });
    expect(sel.selected).toBeNull(); expect(sel.uncertainBlockers).toEqual(['other']);
    expect(relevance(POLICY.relatedAt)).toBe('related'); expect(relevance(POLICY.irrelevantAt)).toBe('irrelevant');
    expect(() => relevance(NaN)).toThrow();
  });

  it('reports indistinguishable candidate profiles and rejects incomplete probabilities', () => {
    const c = config(); c.questions.parsing.models.b = true;
    expect(selectModels(c, { parsing: 1 }).indistinguishableGroups).toEqual([['a', 'b']]);
    expect(() => selectModels(c, {})).toThrow(); expect(() => selectModels(c, { parsing: 1, extra: .1 })).toThrow();
  });
});

describe('batched inference, caching and reports', () => {
  it('batches only feature questions and never sends labels/profiles; persists replayable traces', async () => {
    const p = await temporary(); const client = provider((q) => q.includes('parsing') ? 1 : 0);
    const data = inputs(); data.config.questions.other = { text: 'Other feature?', models: { a: false, b: true } };
    const report = await evaluate(data, { provider: client, output: join(p, 'run'), cache: join(p, 'cache') });
    expect(report.allPassed).toBe(true); expect(client.evaluate).toHaveBeenCalledTimes(1);
    const request = client.evaluate.mock.calls[0][0]; expect(Object.keys(request.questions)).toHaveLength(2);
    expect(request.state).toEqual({ instructions: data.tasks[0].instructions });
    expect(JSON.stringify(request)).not.toMatch(/expected_models|"models"|true|false/);
    expect(report.usage).toEqual({ apiBatches: 1, cachedAnswers: 0, newAnswers: 2 });
    expect(JSON.parse(await readFile(join(p, 'run/report.json'), 'utf8')).tasks[0].selection.selected).toBe('a');
    expect(await readFile(join(p, 'run/report.md'), 'utf8')).toContain('1/1 PASS');
    expect(JSON.parse(await readFile(join(p, 'run/inputs.json'), 'utf8'))).toEqual(data);
  });

  it('reuses profile-only edits, fetches just edited questions, and reports regressions', async () => {
    const p = await temporary(); const client = provider(); const data = inputs(); const cache = join(p, 'cache');
    await evaluate(data, { provider: client, output: join(p, 'first'), cache });
    data.config.questions.parsing.models = { a: false, b: true };
    const second = await evaluate(data, { provider: client, output: join(p, 'second'), cache, offline: true,
      previous: join(p, 'first/report.json') });
    expect(client.evaluate).toHaveBeenCalledTimes(1); expect(second.tasks[0].status).toBe('wrong');
    expect(second.differences).toEqual([{ id: 't', change: 'regressed', before: 'pass', after: 'wrong' }]);
    data.config.questions.parsing.text += ' Clarified.';
    data.config.questions.extra = { text: 'Second question?', models: { a: null, b: null } };
    await evaluate(data, { provider: client, output: join(p, 'third'), cache });
    expect(client.evaluate).toHaveBeenCalledTimes(2); expect(Object.keys(client.evaluate.mock.calls[1][0].questions)).toHaveLength(2);
    data.config.questions.extra.text += ' Updated.';
    const fourth = await evaluate(data, { provider: client, output: join(p, 'fourth'), cache });
    expect(Object.keys(client.evaluate.mock.calls[2][0].questions)).toHaveLength(1);
    expect(fourth.usage.cachedAnswers).toBe(1);
  });

  it('deduplicates identical questions, invalidates by task/version, and enforces offline misses', async () => {
    const p = await temporary(); const client = provider(); const data = inputs();
    data.config.questions.alias = structuredClone(data.config.questions.parsing);
    const first = await evaluate(data, { provider: client, output: join(p, 'first'), cache: join(p, 'cache') });
    expect(first.usage.newAnswers).toBe(1); expect(first.tasks[0].answers).toEqual({ parsing: 1, alias: 1 });
    const key = answerKey('task', 'question', client);
    expect(answerKey('different', 'question', client)).not.toBe(key);
    expect(answerKey('task', 'question', { ...client, version: 'jev-next' })).not.toBe(key);
    data.tasks[0].instructions += ' Changed.';
    const offline = await evaluate(data, { provider: client, output: join(p, 'offline'), cache: join(p, 'cache'), offline: true });
    expect(offline.tasks[0].status).toBe('error'); expect(offline.tasks[0].error).toContain('Offline cache miss');
    expect(client.evaluate).toHaveBeenCalledTimes(1);
  });

  it('does not silently trust corrupt caches or overwrite an existing run', async () => {
    const p = await temporary(); const client = provider(); const cache = join(p, 'cache');
    await evaluate(inputs(), { provider: client, output: join(p, 'first'), cache });
    const [entry] = await readdir(cache); await writeFile(join(cache, entry), '{broken');
    const corrupt = await evaluate(inputs(), { provider: client, output: join(p, 'second'), cache });
    expect(corrupt.tasks[0].error).toContain('Invalid cache');
    await expect(evaluate(inputs(), { provider: client, output: join(p, 'first'), cache })).rejects.toThrow();
    expect(client.evaluate).toHaveBeenCalledTimes(1);
  });

  it('supports partial batch failure recovery and never grades incomplete inference', async () => {
    const p = await temporary(); const client = provider(); const data = inputs();
    data.config.questions.extra = { text: 'Another question?', models: { a: true, b: null } };
    client.evaluate
      .mockImplementationOnce(async request => ({ model: 'jev-test', answers: Object.fromEntries(
        Object.keys(request.questions).map(id => [id, { type: 'noul' as const, noul: 1 }])) }))
      .mockResolvedValueOnce({ model: 'jev-test', answers: {} });
    const fail = await evaluate(data, { provider: client, output: join(p, 'failed'), cache: join(p, 'cache'), batchSize: 1 });
    expect(fail.tasks[0].status).toBe('error'); expect(fail.tasks[0].selection).toBeUndefined();
    expect(fail.allPassed).toBe(false);
    expect(fail.tasks[0].answers).toEqual({ parsing: 1 });
    expect(fail.usage).toEqual({ apiBatches: 2, cachedAnswers: 0, newAnswers: 1 });
    const retry = await evaluate(data, { provider: client, output: join(p, 'retry'), cache: join(p, 'cache'), batchSize: 1 });
    expect(retry.allPassed).toBe(true);
    expect(retry.usage).toEqual({ apiBatches: 1, cachedAnswers: 1, newAnswers: 1 });
    expect(client.evaluate).toHaveBeenCalledTimes(3);
  });

  it('reports answer-pattern collisions and changed labels as incomparable', async () => {
    const p = await temporary(); const client = provider(); const data = inputs();
    data.tasks.push({ id: 'other', instructions: 'A different parsing problem.', expected_models: ['b'] });
    const first = await evaluate(data, { provider: client, output: join(p, 'first'), cache: join(p, 'cache') });
    expect(first.collisions).toEqual([{ tasks: ['t', 'other'], expected: { t: ['a'], other: ['b'] } }]);
    data.tasks[0].expected_models = ['b']; data.tasks.pop();
    const second = await evaluate(data, { provider: client, output: join(p, 'second'), cache: join(p, 'cache'), previous: join(p, 'first/report.json') });
    expect(second.differences.map(d => d.change)).toEqual(['incomparable', 'removed']);
    const altered: Report = JSON.parse(await readFile(join(p, 'first/report.json'), 'utf8')); altered.engineFingerprint = hash('altered engine');
    await writeFile(join(p, 'altered.json'), JSON.stringify(altered));
    await expect(evaluate(data, { provider: client, output: join(p, 'invalid'), cache: join(p, 'cache'), previous: join(p, 'altered.json') })).rejects.toThrow(/different engine/);
  });

  it('reports overlapping but different expected sets as collisions and explains missing/extra models', async () => {
    const p = await temporary(); const data = inputs(); const client = provider();
    data.config.questions.parsing.models.b = true;
    data.tasks.push({ id: 'both', instructions: 'Another parser.', expected_models: ['a', 'b'] });
    const report = await evaluate(data, { provider: client, output: join(p, 'run'), cache: join(p, 'cache') });
    expect(report.tasks.map(t => t.status)).toEqual(['wrong', 'pass']);
    expect(report.collisions).toEqual([{ tasks: ['t', 'both'], expected: { t: ['a'], both: ['a', 'b'] } }]);
    expect(await readFile(join(p, 'run/report.md'), 'utf8')).toContain('Unexpected models: b');
    data.tasks[0].expected_models = ['b', 'a'];
    const same = await evaluate(data, { provider: client, output: join(p, 'same'), cache: join(p, 'cache'), offline: true });
    expect(same.allPassed).toBe(true); expect(same.collisions).toEqual([]);
  });
});

describe('Cloudflare transport', () => {
  const env = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'secret-token-test' };
  const request: JevRequest = { state: { instructions: 'Task' }, questions: { q: { type: 'noul', instructions: 'Feature?' } } };
  const good = { model: 'jev-test', answers: { q: { type: 'noul', noul: .9 } } };
  it('uses the documented batched shape and retries 429 without exposing response bodies', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('secret-token-test', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: { state: 'completed', result: good, gatewayMetadata: {} } })));
    const sleep = vi.fn(async () => {});
    const client = cloudflareProvider({ env, version: 'jev-test', fetch: fetcher, sleep });
    expect((await client.evaluate(request)).answers.q.noul).toBe(.9);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(sleep).toHaveBeenCalledWith(1000);
    expect(fetcher.mock.calls[0][0]).toBe(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run`);
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({ model: 'typesafe/jev', input: request });
  });
  it('does not retry authentication errors or include secret-bearing errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret-token-test', { status: 401 }));
    await expect(cloudflareProvider({ env, version: 'jev-test', fetch: fetcher }).evaluate(request)).rejects.toThrow('Jev HTTP 401');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const broken = vi.fn<typeof fetch>().mockRejectedValue(new Error('secret-token-test'));
    await expect(cloudflareProvider({ env, version: 'jev-test', fetch: broken, sleep: async () => {} }).evaluate(request)).rejects.toThrow('Jev network request failed after 3 attempts');
    expect(broken).toHaveBeenCalledTimes(3);
  });
  it('rejects malformed, missing, out-of-range and version-mixed responses', () => {
    for (const value of [null, { ...good, model: 'jev-next' }, { ...good, answers: {} },
      { ...good, answers: { q: { type: 'noul', noul: '0.9' } } },
      { ...good, answers: { q: { type: 'noul', noul: NaN } } },
      { ...good, answers: { q: { type: 'noul', noul: 1.1 } } },
      { ...good, answers: { ...good.answers, extra: good.answers.q } }]) {
      expect(() => validateResult(value, request, 'jev-test')).toThrow();
    }
  });
});

describe('eval-engine CLI', () => {
  it('switches to OR offline and back to default AND without changing candidates or making new calls', async () => {
    const p = await temporary(); const client = provider(0); const stdout = vi.fn(); const stderr = vi.fn();
    const q = join(p, 'q.yaml'), b = join(p, 'b.yaml');
    await writeFile(q, stringify(config())); await writeFile(b, stringify({ tasks: inputs().tasks }));
    const args = ['run', '--questions', q, '--bench', b, '--cache', join(p, 'cache')];
    const deps = { provider: client, stdout, stderr };
    expect(await runEvalCli([...args, '--out', join(p, 'and')], deps)).toBe(1);
    expect(await runEvalCli([...args, '--offline', '--match-mode', 'or', '--out', join(p, 'or')], deps)).toBe(0);
    expect(await runEvalCli([...args, '--offline', '--out', join(p, 'restored')], deps)).toBe(1);
    const original: Report = JSON.parse(await readFile(join(p, 'and/report.json'), 'utf8'));
    const overlap: Report = JSON.parse(await readFile(join(p, 'or/report.json'), 'utf8'));
    const restored: Report = JSON.parse(await readFile(join(p, 'restored/report.json'), 'utf8'));
    expect(overlap.matchMode).toBe('or'); expect(restored.matchMode).toBe('and');
    expect(overlap.tasks[0].selection).toEqual(original.tasks[0].selection);
    expect(overlap.tasks[0].answers).toEqual(original.tasks[0].answers);
    expect(restored.totals).toEqual(original.totals);
    expect(client.evaluate).toHaveBeenCalledTimes(1);
    expect(await runEvalCli([...args, '--match-mode', 'bad'], deps)).toBe(2);
    expect(await runEvalCli([...args, '--offline', '--match-mode', 'or', '--previous', join(p, 'and/report.json'),
      '--out', join(p, 'mixed')], deps)).toBe(2);
    expect(stderr.mock.calls.at(-1)?.[0]).toContain('different match mode');
  });
  it('validates without credentials and selects one task with distinct exit codes', async () => {
    const p = await temporary(); const client = provider(); const stdout = vi.fn(); const stderr = vi.fn();
    const q = join(p, 'q.yaml'), b = join(p, 'b.yaml');
    await writeFile(q, stringify(config())); await writeFile(b, stringify({ tasks: [inputs().tasks[0],
      { id: 'wrong-task', instructions: 'Another task.', expected_models: ['b'] }] }));
    const common = ['--questions', q, '--bench', b];
    expect(await runEvalCli(['validate', ...common], { env: {}, stdout, stderr })).toBe(0);
    expect(await runEvalCli(['run', ...common, '--task', 't', '--out', join(p, 'pass'), '--cache', join(p, 'cache')], { provider: client, stdout, stderr })).toBe(0);
    expect(client.evaluate).toHaveBeenCalledTimes(1);
    expect(await runEvalCli(['run', ...common, '--task', 'wrong-task', '--out', join(p, 'wrong'), '--cache', join(p, 'cache')], { provider: client, stdout, stderr })).toBe(1);
    expect(await runEvalCli(['run', ...common, '--task', 'missing'], { provider: client, stdout, stderr })).toBe(2);
    expect(await runEvalCli(['run', ...common, '--task', 't', '--offline', '--out', join(p, 'miss'), '--cache', join(p, 'empty')], { provider: client, stdout, stderr })).toBe(2);
    expect(await runEvalCli(['--help'], { stdout, stderr })).toBe(0);
    expect(await runEvalCli(['run', ...common, '--surprise'], { stdout, stderr })).toBe(2);
  });
});
