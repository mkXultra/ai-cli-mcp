# Model selection evaluation engine

`eval-engine` loads a question bank and labeled benchmark from YAML, asks Jev
feature questions in batches, and reports model-selection failures. It does not
execute coding models: PASS measures agreement with imported labels, not coding
task completion. Start with one task and add more later.

## Run

```bash
npm run build
node dist/bin/eval-engine.js validate \
  --questions examples/eval-engine/question.yaml \
  --bench examples/eval-engine/bench.yaml

node dist/bin/eval-engine.js run \
  --questions examples/eval-engine/question.yaml \
  --bench examples/eval-engine/bench.yaml \
  --env-file .env
```

The examples use fictional model profiles to test the plumbing, not measured
capabilities of real models. After installing this package, use `eval-engine`
instead of `node dist/bin/eval-engine.js`. For development, use
`npm run -s eval-engine -- run ...`. Keep the same invocation/build when comparing
reports: source and compiled engine fingerprints differ.

Set `CLOUDFLARE_ACCOUNT_ID` (32 hexadecimal characters) and
`CLOUDFLARE_API_TOKEN`, or supply `--env-file`. Existing environment values take
precedence. Environment files are never loaded implicitly.

```bash
# One task; --task can be repeated.
eval-engine run --questions question.yaml --bench bench.yaml --task async-ui

# Profile-only changes can be evaluated without network access.
eval-engine run --questions question.yaml --bench bench.yaml --offline \
  --previous .eval-engine/runs/previous/report.json

# Obtain fresh answers to measure variability.
eval-engine run --questions question.yaml --bench bench.yaml --refresh
```

Exit codes: `0` = all PASS / validation OK; `1` = benchmark failures; `2` = input,
API, or cache errors. Per-task errors remain in the denominator, and other tasks
still run. Configuration validation happens before API calls. See `--help` for
all options, including `--out`, `--cache`, `--batch-size`, and `--jev-version`.

## question.yaml

```yaml
version: 1
models: [astra, terra, luna]
questions:
  reject_stale_result:
    text: Must results from an older asynchronous operation be discarded after a newer operation takes precedence?
    models:
      astra: true
      terra: false
      luna: null
```

These values illustrate the format, not established model capabilities:

- `true`: positive suitability evidence for this requirement.
- `false`: negative suitability evidence. In this engine it is an explicit
  exclusion condition when the requirement is relevant.
- `null`: unknown. Retain the candidate; do not treat this as `false` or positive
  evidence.

Write narrow questions about whether a requirement is present in the task. Every
question must contain all declared model keys. Quoted `"true"` is invalid. IDs
start with a letter and may contain letters, digits, `_`, `-`, and `.` (maximum
128 characters). Duplicate IDs/keys, extra fields, empty banks, YAML aliases, and
custom tags are rejected.

Jev receives only the task and question texts, never model profiles or labels:

```json
{
  "state": { "instructions": "The task text..." },
  "questions": {
    "q_<content-hash>": {
      "type": "noul",
      "instructions": "Does the task require ...?"
    }
  }
}
```

Request IDs are content hashes so identical questions can share answers. Reports
map these answers back to YAML question IDs. The official
[Jev model page](https://developers.cloudflare.com/ai/models/typesafe/jev/)
documents the batched Noul request/response shape.

## bench.yaml

```yaml
version: 1
tasks:
  - id: async-ui
    instructions_file: tasks/async-ui.md
    expected_models: [astra]
  - id: small-parser
    instructions: Parse a small expression language into an AST.
    expected_models: [terra, astra]
```

Benchmark `version: 1` is optional. Supply exactly one of `instructions` and
`instructions_file`. File paths resolve relative to the benchmark YAML, not the
working directory. Expected labels must name declared models. Multiple expected
models form the **exact required candidate set** by default (AND): all listed models must
remain and no extra models may remain. Ordering does not matter. For example,
`[astra, terra, luna]` requires all three; `[astra]` requires Astra alone.

There is no effort field or automatic label derivation. When importing measured
results, document and hold fixed both effort and the rule for expected models.

## Fixed selection policy

The policy is in the engine, outside the editable YAML:

1. Noul probability `>= 0.8` is related; `<= 0.2` is irrelevant; otherwise uncertain.
   These are operational thresholds, not calibrated coding-success probabilities.
2. For a related question, exclude remaining models mapped to `false`; retain
   `true` and `null`. Ignore irrelevant questions entirely.
3. Uncertain questions stay pending. If one could exclude any surviving model,
   the candidate set is unresolved.
4. Require at least one related `true` entry for every survivor. A model retained
   solely because its evidence is unknown does not make a resolved set.
5. Compare the entire candidate set to `expected_models`. Missing or extra models
   mean `wrong`; an empty set means `no_match`. An exact match without sufficient
   evidence or with pending exclusions is `unresolved`. Only a resolved exact
   match is `pass`. Multiple candidates are valid when all are required.

Statuses are `pass`, `wrong`, `unresolved`, `no_match`, and `error`. `no_match` means
all candidates were excluded. Reports show missing/extra models, the question
that removed each expected model, and the first loss of any expected model
(as well as the point all were lost). Traces
follow YAML order; the final exclusion set is order-independent.

This is stricter than the earlier exploratory Pareto comparisons. A negative
association in a small dataset is not automatically a justified hard exclusion.
Encode `false` only when that is the intended branch; conflicting exclusions
surface as `no_match`. There is no overall success-rate prior, weighted average,
model-order tie-break, or oracle choice from an unresolved set.

Policy `model-set-v2` replaces the earlier single-model OR grading. Previously
passing subsets now fail. `selection.candidates` is the output being graded;
`selection.resolved` describes its evidence, and `selection.selected` is only a
display convenience for a resolved singleton. Existing Jev answer caches remain
valid because inference inputs are unchanged. Old reports remain historical;
re-evaluate under the new policy before using `--previous` to compare runs.

## Batching, caching, and reproducibility

### Optional OR coverage comparison

Use `--match-mode or` to count PASS when the remaining candidates contain at least
one expected model. This is raw candidate coverage: missing/extra candidates,
insufficient positive evidence, and uncertain exclusions do not prevent PASS.
An empty set is `no_match`; a nonempty disjoint set is `wrong`. Selection, Jev
requests, and evidence diagnostics remain unchanged. Returning every model can
score 100% by this metric, so inspect candidate counts alongside PASS rates.
This is neither single-model accuracy nor coding-task success rate.

```bash
eval-engine run --questions question.yaml --bench bench.yaml --offline --match-mode or
# Restore the original policy simply by omitting the flag, or specify --match-mode and.
eval-engine run --questions question.yaml --bench bench.yaml --offline --match-mode and
```

AND remains the default; no persistent setting is changed. JSON and Markdown
reports record the grading policy. `--previous` rejects comparisons across modes
so relaxing the metric cannot be reported as a tuning fix. Cached answers can be
reused across modes. Identical-answer/different-label groups are still reported;
in OR mode one candidate set can satisfy several different expected sets.

- Default: 64 uncached questions per request. `--batch-size` accepts 1–256 as a
  local resource bound, **not** an API question-limit claim. Large texts can still
  exceed the provider context budget.
- Cache keys include provider, expected model version, request format, task text,
  and question text. Profile/label/ID changes reuse answers. Changed task or
  question text creates new keys. Identical question text is deduplicated.
- The default expected response version is `jev-1.13.0`. Cloudflare serves an
  alias; a changed returned version fails explicitly. Verify the served version
  before changing `--jev-version`, which creates a new cache namespace.
- `--offline` never calls Jev and fails tasks on cache misses/corruption.
  `--refresh` requests fresh answers and replaces matching cache entries. They
  cannot be combined.
- Every run uses a new directory; an existing `--out` is rejected before API
  calls. Reports include task text and exact probabilities. Credentials and raw
  provider error bodies are not logged.
- Transport/429/5xx failures have at most three attempts with bounded backoff and
  a 60-second request timeout. Errors never count as PASS.

Each run saves:

- `report.md`: summary, failures, elimination traces, and previous-run differences.
- `report.json`: probabilities, candidates, unknown entries, uncertain blockers,
  expected-model losses, engine/input hashes, and cache provenance.
- `inputs.json`: resolved task text, labels, and the exact question/profile bank.
- `batches/*.json`: actual requests and validated responses, without credentials.
- `progress.json`: completed tasks. Reruns reuse successfully cached answers after
  an interruption or partial failure.

`--previous report.json` identifies fixed/regressed/changed tasks, additions, and
removals. Changed task text or expected labels are `incomparable`, not fixes.
Different engines, model catalogs, or provider versions cannot be compared.

The report detects tasks with identical relevance patterns but different expected
sets, including overlapping sets: the same feature vector cannot produce two
different candidate sets. It also
groups remaining models with identical profiles on related features.

## Agent improvement contract

```text
Edit only question.yaml: question text, additions/removals, and model values.
Do not edit the engine, benchmark labels, cached answers, or historical reports.
Run the fixed eval-engine command after each change; use --previous for comparison.
Inspect failures, expected-model loss points, unknowns, and answer-pattern collisions.
Stop at all PASS or the specified round/API budget.
Return the best question.yaml, reports, and remaining failures.
```

Keep a separate confirmation benchmark hidden from the tuning agent. Passing all
tuning tasks does not establish generalization. The engine does not automatically
launch agents or run unbounded improvement loops.

## Tests

```bash
npm run build
npm run test:unit -- src/__tests__/eval-engine.test.ts
npm run test:release
```

Tests use injected providers and temporary files. They require no credentials and
do not call external AI services. Real Jev calls occur only in explicit `run`
commands with cache misses or `--refresh`.
