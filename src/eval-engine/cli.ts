import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { loadInputs } from './config.js';
import { evaluate } from './engine.js';
import { cloudflareProvider, DEFAULT_JEV_VERSION, type Provider } from './provider.js';

const HELP = `Usage: eval-engine <run|validate> --questions question.yaml --bench bench.yaml [options]

  --task ID            Evaluate only this task (repeatable)
  --out DIR            New run directory (must not exist; default .eval-engine/runs/<unique-id>)
  --cache DIR          Per-question cache (default .eval-engine/cache)
  --env-file FILE      Read Cloudflare credentials; existing environment takes precedence
  --offline            Use cached answers only; never call Jev
  --refresh            Request fresh answers and replace matching cache entries
  --match-mode MODE    and (default): resolved exact set; or: any candidate overlaps expected
  --batch-size N       Questions per call, 1..256 (default 64; local bound, not a claimed API limit)
  --jev-version NAME   Require this returned version (default ${DEFAULT_JEV_VERSION})
  --previous FILE      Compare with an earlier report.json under the same engine/provider
  --help               Show this help

Exit codes: 0 = all passed / validation OK; 1 = benchmark failures; 2 = input/API/cache errors.
AND requires exact set equality, positive support for every survivor, and no unresolved exclusion.
OR measures candidate coverage only, including unresolved candidates; it does not select a model.
Jev only receives task instructions and feature questions, never expected labels or model profiles.
`;

export async function runEvalCli(argv: string[], dependencies: {
  env?: NodeJS.ProcessEnv; provider?: Provider; stdout?: (s: string) => void; stderr?: (s: string) => void;
} = {}): Promise<number> {
  const out = dependencies.stdout ?? (s => process.stdout.write(s));
  const err = dependencies.stderr ?? (s => process.stderr.write(s));
  try {
    const { values, positionals } = parseArgs({ args: argv, strict: true, allowPositionals: true, options: {
      questions: { type: 'string' }, bench: { type: 'string' }, task: { type: 'string', multiple: true },
      out: { type: 'string' }, cache: { type: 'string' }, 'env-file': { type: 'string' },
      offline: { type: 'boolean' }, refresh: { type: 'boolean' }, 'batch-size': { type: 'string' },
      'match-mode': { type: 'string' },
      'jev-version': { type: 'string' }, previous: { type: 'string' }, help: { type: 'boolean' },
    } });
    if (values.help || !argv.length) { out(HELP); return 0; }
    if (positionals.length !== 1 || !['run', 'validate'].includes(positionals[0]) || !values.questions || !values.bench) {
      throw new Error('Specify run or validate with --questions and --bench. Use --help for usage.');
    }
    const matchMode = values['match-mode'] ?? 'and';
    if (matchMode !== 'and' && matchMode !== 'or') throw new Error('--match-mode must be and or or');
    const inputs = await loadInputs(resolve(values.questions), resolve(values.bench));
    if (values.task) {
      for (const id of values.task) if (!inputs.tasks.some(t => t.id === id)) throw new Error(`Unknown task: ${id}`);
      inputs.tasks = inputs.tasks.filter(t => values.task!.includes(t.id));
    }
    if (positionals[0] === 'validate') {
      out(`Valid: ${inputs.config.models.length} models, ${Object.keys(inputs.config.questions).length} questions, ${inputs.tasks.length} tasks\n`); return 0;
    }
    const version = values['jev-version'] ?? DEFAULT_JEV_VERSION;
    if (!/^jev-[A-Za-z0-9.-]+$/.test(version)) throw new Error('Invalid --jev-version');
    const fileEnv = values['env-file'] ? parseEnv(await readFile(resolve(values['env-file']), 'utf8')) : {};
    const env = { ...fileEnv, ...(dependencies.env ?? process.env) };
    const provider = dependencies.provider ?? cloudflareProvider({ env, version, onRetry: n => err(`Jev retry ${n}/2\n`) });
    const output = resolve(values.out ?? `.eval-engine/runs/${Date.now()}-${randomUUID().slice(0, 8)}`);
    const report = await evaluate(inputs, { provider, output, cache: resolve(values.cache ?? '.eval-engine/cache'),
      offline: values.offline, refresh: values.refresh, matchMode, batchSize: values['batch-size'] === undefined ? 64 : Number(values['batch-size']),
      previous: values.previous && resolve(values.previous), progress: s => err(s + '\n') });
    out(`${report.totals.pass}/${report.totals.total} PASS\nReport: ${output}/report.md\nJSON: ${output}/report.json\n`);
    return report.totals.error ? 2 : report.allPassed ? 0 : 1;
  } catch (error) { err(`eval-engine: ${error instanceof Error ? error.message : 'Failed'}\n`); return 2; }
}
