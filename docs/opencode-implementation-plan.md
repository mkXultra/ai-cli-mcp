# OpenCode Backend Integration Plan

## Goal

Add OpenCode as a new backend in `ai-cli-mcp` so callers can launch OpenCode through the same MCP and `ai-cli` interfaces used for Claude, Codex, Gemini, and Forge.

## Scope

- Add a new backend named `opencode`
- Support default OpenCode execution with `model: "opencode"`
- Support explicit OpenCode model selection with `model: "oc-<provider/model>"`
- Support session resume for OpenCode
- Parse OpenCode non-interactive JSON event output into the existing structured result shape
- Expose OpenCode machine-readably in `ai-cli models`
- Expose OpenCode in CLI help, MCP tool descriptions, doctor output, README files, and tests

## Non-Goals

- Add static catalog entries for every OpenCode model
- Map `reasoning_effort` to OpenCode `--variant`
- Integrate against `opencode serve` HTTP APIs in this change
- Introduce provider-specific OpenCode options beyond model and session resume

## User-Facing Behavior

### Model selection

- `model: "opencode"` runs OpenCode with its default configured model
- `model: "oc-openai/gpt-5.4"` runs OpenCode with `--model openai/gpt-5.4`
- `model: "oc-zai-coding-plan/glm-5.1"` runs OpenCode with `--model zai-coding-plan/glm-5.1`

### Explicit OpenCode model syntax

Explicit OpenCode models must use this exact wrapper syntax:

```text
oc-<provider/model>
```

Validation rules:

- Validate against the raw input string before alias resolution
- Reject leading or trailing whitespace by requiring `rawModel === rawModel.trim()`
- Require the `oc-` prefix
- Require at least one `/` after `oc-`
- Split the remainder at the first `/`
- Reject empty provider and empty model segments
- Do not add any extra normalization beyond stripping the `oc-` prefix before passing the value to OpenCode

Examples to reject:

- `oc-`
- `oc-openai`
- `oc-/gpt-5.4`
- `oc-openai/`
- ` oc-openai/gpt-5.4`
- `oc-openai/gpt-5.4 `

### Session handling

OpenCode resume is defined as in-place resume, not forked resume.

- `session_id` for OpenCode maps to `--session <session_id>`
- There is no OpenCode equivalent of Claude's `--fork-session` in this integration
- A resumed OpenCode run continues the same conversation/session lineage
- `model + session_id` is allowed for OpenCode resumed runs
- When both are supplied, the wrapper passes both `--session <id>` and `--model <provider/model>` to the CLI
- The wrapper persists the `session_id` parsed from OpenCode events; resumed runs should continue returning a parseable `session_id`

Required test coverage:

- resumed `model: "opencode"` run
- resumed `model: "oc-<provider/model>"` run

### Reasoning effort

- `reasoning_effort` remains unsupported for OpenCode
- `getReasoningEffort()` must reject OpenCode explicitly with a clear error, matching the existing explicit Forge rejection pattern

## CLI Invocation Design

Use OpenCode's non-interactive mode:

```bash
opencode run --format json --dir <workFolder> [--session <session_id>] [--model <provider/model>] <prompt>
```

Command variants:

- default OpenCode:
  - `opencode run --format json --dir <cwd> <prompt>`
- resumed default OpenCode:
  - `opencode run --format json --dir <cwd> --session <session_id> <prompt>`
- explicit OpenCode model:
  - `opencode run --format json --dir <cwd> --model <provider/model> <prompt>`
- resumed explicit OpenCode model:
  - `opencode run --format json --dir <cwd> --session <session_id> --model <provider/model> <prompt>`

Rationale:

- `run --format json` produces NDJSON events that are easier to parse than formatted terminal output
- `--session` supports in-place resume directly
- `--model` accepts the same `provider/model` strings returned by `opencode models`
- `spawn(..., { cwd })` and `--dir <cwd>` should both be used intentionally

Why keep both `cwd` and `--dir`:

- `cwd` controls where the OS process is launched and keeps behavior consistent with other backends
- `--dir` tells OpenCode which project directory to operate on, independent of shell state
- Keeping both set to the requested work folder avoids ambiguity if OpenCode derives workspace behavior from its own flag rather than process cwd
- Tests should assert both the spawned cwd and the `--dir` argument are set to the requested work folder

## Internal Design

### 1. Model routing and validation

Update model routing so:

- `model === "opencode"` maps to agent `opencode`
- `model.startsWith("oc-")` maps to agent `opencode` after explicit validation succeeds
- only the explicit `oc-<provider/model>` wrapper syntax is accepted for model-selected OpenCode runs
- `oc-` is stripped only after validation and only before passing the OpenCode model string to the CLI
- existing provider routing remains unchanged

Implementation impact:

- `src/cli-builder.ts`
- `src/model-catalog.ts`
- `src/__tests__/cli-builder.test.ts`
- `src/__tests__/validation.test.ts`

### 2. Type widening and dispatch touchpoints

This change must update every backend-dispatch type and switch site explicitly. The implementation should not rely on incidental widening.

Required touchpoints:

- widen `AgentType` in `src/process-service.ts` to include `opencode`
- widen `CliCommand.agent` in `src/cli-builder.ts` to include `opencode`
- widen `CliBinaryName` in `src/cli-utils.ts` to include `opencode`
- widen `StoredProcess.toolType` in `src/cli-process-service.ts` to include `opencode`
- widen the shared `cliPaths` type used by `BuildCliCommandOptions`, `ProcessService`, `CliProcessService`, `src/cli.ts`, and `src/app/mcp.ts` to include an `opencode` key
- add OpenCode parser dispatch in `ProcessService.getProcessResult()`
- add OpenCode parser dispatch in `CliProcessService.getProcessResult()`
- update `src/cli-parse.ts`:
  - `AGENTS` list
  - usage text
  - `--agent` validation
  - parse switch

Recommendation:

- extract the repeated inline `cliPaths` object type into one exported shared type so the new `opencode` key is added once and reused consistently

### 3. CLI binary detection

Add OpenCode binary discovery alongside the existing backends:

- env var override: `OPENCODE_CLI_NAME`
- default binary: `opencode`
- local install fallback: do not invent a new local-install convention unless verified from the existing codebase or product docs; default binary plus env override is sufficient for this plan

Implementation impact:

- `src/cli-utils.ts`
- `src/server.ts`
- `src/app/mcp.ts`
- `src/cli.ts`
- `src/cli-process-service.ts`
- `src/__tests__/cli-utils.test.ts`
- `src/__tests__/server.test.ts`

### 4. Command construction

Add OpenCode command assembly in `buildCliCommand()`:

- default OpenCode:
  - args: `run --format json --dir <cwd> <prompt>`
- resumed OpenCode:
  - args: `run --format json --dir <cwd> --session <session_id> <prompt>`
- explicit OpenCode model:
  - args: `run --format json --dir <cwd> --model <provider/model> <prompt>`
- resumed explicit OpenCode model:
  - args: `run --format json --dir <cwd> --session <session_id> --model <provider/model> <prompt>`

OpenCode should not receive any existing Claude/Codex/Gemini/Forge-specific flags.

Required command invariants:

- `model: "opencode"` must omit `--model`
- `model: "oc-<provider/model>"` must include `--model <provider/model>`
- resumed `model: "opencode"` runs must still omit `--model`
- resumed `model: "oc-<provider/model>"` runs must include both `--session <id>` and `--model <provider/model>`
- `--dir <cwd>` must always be present for OpenCode runs

Implementation impact:

- `src/cli-builder.ts`
- `src/cli.ts`
- `src/__tests__/cli-builder.test.ts`
- `src/__tests__/mcp-contract.test.ts`
- `src/__tests__/e2e.test.ts`

Direct helper entrypoints:

- update the `src/cli.ts` `USAGE` text so OpenCode is named in the model examples and `cli.run.parse` examples include `--agent opencode`
- update the `src/cli-parse.ts` `USAGE` text and examples to include `opencode`

### 5. Reasoning-effort rejection

`getReasoningEffort()` must reject OpenCode explicitly rather than falling through generic family logic.

Required behavior:

- `getReasoningEffort('opencode', 'high')` throws a dedicated OpenCode error
- explicit `oc-<provider/model>` input also throws the same OpenCode-specific error
- empty or absent `reasoning_effort` still resolves to `''`

Implementation impact:

- `src/cli-builder.ts`
- `src/__tests__/cli-builder.test.ts`
- `src/__tests__/validation.test.ts`

### 6. Output parsing

Implement `parseOpenCodeOutput(stdout: string)` against OpenCode NDJSON event output.

Observed event examples:

```json
{"type":"step_start","sessionID":"ses_xxx"}
{"type":"text","sessionID":"ses_xxx","part":{"type":"text","text":"HI"}}
{"type":"step_finish","sessionID":"ses_xxx","part":{"type":"step-finish","tokens":{"total":11833},"cost":0}}
```

Parsing contract:

- Parse stdout only
- Do not merge stderr into the OpenCode parser input
- Treat stdout as line-delimited JSON events
- Ignore malformed lines and unknown event types
- Track the latest `sessionID` seen on any event
- On each `step_start`, reset the current-step text buffer
- Append assistant text only from `type === "text"` events whose `part.type === "text"`
- Maintain a current-step text buffer
- On each `step_finish`, promote the current-step buffer to the latest completed step and capture `tokens` and `cost`
- If multiple steps are emitted, return the last completed step

Fallback behavior:

- If at least one `step_finish` exists, return the latest completed step payload
- If no `step_finish` exists but parseable assistant text exists, return a partial payload with `message` and `session_id`, omitting `tokens` and `cost`
- If no parseable OpenCode events exist, return `null`
- Parser output alone must never decide failure shaping
- For OpenCode runs whose tracked process status is `failed`, raw `stdout` and raw `stderr` must always be preserved in the final result shape
- Failed OpenCode runs must not hide stderr just because the parser extracted assistant text, a `session_id`, or a completed step
- Compact failed OpenCode results should prefer raw output over parsed `agentOutput`
- Verbose failed OpenCode results may include parsed OpenCode output as supplemental `agentOutput`, but only in addition to raw `stdout` and `stderr`
- This explicitly requires result-shaping changes in the OpenCode path, not only parser changes

This is intentionally different from Codex, which parses combined stdout+stderr today.

Proposed parsed shape:

```json
{
  "message": "assistant text",
  "session_id": "ses_xxx",
  "tokens": { "total": 11833 },
  "cost": 0
}
```

Implementation impact:

- `src/parsers.ts`
- `src/process-service.ts`
- `src/cli-process-service.ts`
- `src/process-result.ts`
- `src/cli-parse.ts`
- `src/__tests__/parsers.test.ts`
- `src/__tests__/cli-process-service.test.ts`

### 6a. Detached process exit-status capture

The detached `CliProcessService` path currently cannot reliably report non-zero exits after the parent CLI process exits. OpenCode failed-run shaping therefore needs one prerequisite design decision:

- detached runs must persist terminal exit metadata that can be read later by `CliProcessService`
- `CliProcessService.refreshStatus()` must be able to set `status: "failed"` for detached runs, not only `completed`
- detached result shaping for OpenCode must key off persisted exit metadata rather than assuming every exited PID completed successfully

Required implementation contract:

- persist an exit-status sidecar for detached runs inside the process state directory
- the stored metadata must include at least:
  - terminal status: `completed` or `failed`
  - `exitCode` when available
- `CliProcessService.getProcessResult()` must pass the persisted `exitCode` into `buildProcessResult()`
- failed detached OpenCode runs must preserve raw `stdout` and `stderr` exactly like failed in-memory `ProcessService` runs

Scoping decision for this change:

- apply detached exit-status capture only to OpenCode-backed detached runs in this change
- `CliProcessService.startProcess()` therefore needs agent-conditional logic for the OpenCode path
- existing detached Claude/Codex/Gemini/Forge behavior remains unchanged in this change and retains the pre-existing limitation that exited processes are surfaced as completed unless broader exit tracking is added later
- the OpenCode-specific detached wrapper or monitor must still forward termination correctly enough that `killProcess()` semantics remain intact for OpenCode runs

Acceptable implementation approaches:

- add a minimal detached wrapper that launches the real CLI, waits for it, and writes exit metadata before exiting
- or add an equivalent monitoring mechanism that is guaranteed to survive the launching process exiting

This prerequisite is not OpenCode-specific in principle, but it is required in this change because OpenCode failed-run behavior is part of the acceptance criteria.

Implementation impact:

- `src/cli-process-service.ts`
- detached process state files under the CLI state directory
- `src/process-result.ts`
- `src/__tests__/cli-process-service.test.ts`
- `src/__tests__/mcp-contract.test.ts`

### 7. Public model catalog and `ai-cli models` payload

Expose OpenCode without pretending the project owns a static OpenCode model catalog.

Required behavior:

- add `"opencode"` to the supported model descriptions
- document `oc-<provider/model>` as accepted wrapper syntax
- do not add a static array of OpenCode models
- extend the `ai-cli models` payload so OpenCode is represented machine-readably

Exact payload contract:

```json
{
  "aliases": [...],
  "claude": [...],
  "codex": [...],
  "gemini": [...],
  "forge": [...],
  "opencode": ["opencode"],
  "dynamicModelBackends": {
    "opencode": {
      "explicitPrefix": "oc-",
      "explicitPattern": "oc-<provider/model>",
      "discoveryCommand": "opencode models",
      "modelsAreDynamic": true
    }
  }
}
```

Notes:

- field names in the payload above are fixed for this change and should not be renamed
- preserve the existing top-level shape where backend entries are arrays by adding `opencode: ["opencode"]`
- `dynamicModelBackends` is the new exact extension point for dynamic backends in this change
- no static OpenCode catalog is added; `opencode` contains only the default wrapper token
- `getSupportedModelsDescription()` and `getModelParameterDescription()` should describe both `opencode` and `oc-<provider/model>` consistently with the machine-readable payload
- `ai-cli models` help text should remain short; the JSON payload is the authoritative machine-readable contract

Implementation impact:

- `src/model-catalog.ts`
- `src/app/cli.ts`
- `src/app/mcp.ts`
- `README.md`
- `README.ja.md`
- `src/__tests__/app-cli.test.ts`
- `src/__tests__/cli-bin-smoke.test.ts`

### 8. Doctor output and tool descriptions

Update doctor/status surfaces and user-facing descriptions together.

Required changes:

- widen `getCliDoctorStatus()` return type and JSON shape to include `opencode`
- add OpenCode binary resolution to doctor output in both CLI and MCP-facing documentation
- update MCP `run` tool description to mention OpenCode in supported models
- update MCP `session_id` description to include OpenCode
- update MCP `reasoning_effort` description to say it is supported only for Claude and Codex, and unsupported for Gemini, Forge, and OpenCode
- update CLI `RUN_HELP_TEXT`, `MODELS_HELP_TEXT`, and `DOCTOR_HELP_TEXT` wording accordingly

Implementation impact:

- `src/cli-utils.ts`
- `src/app/cli.ts`
- `src/app/mcp.ts`
- `src/cli.ts`
- `src/cli-parse.ts`
- `src/__tests__/cli-utils.test.ts`
- `src/__tests__/server.test.ts`
- `src/__tests__/e2e.test.ts`

## Validation and Error Handling

- Reject `reasoning_effort` for OpenCode in `getReasoningEffort()`
- Reject malformed explicit OpenCode models unless they exactly satisfy `oc-<provider/model>`
- Reject surrounding whitespace instead of silently trimming it away
- Preserve existing behavior for other model families
- Keep OpenCode explicit models opaque after successful validation; the wrapper validates syntax only, not provider/model existence

## Test Plan

### Unit tests

- `src/__tests__/cli-builder.test.ts`
  - routes `opencode`
  - routes valid `oc-openai/gpt-5.4`
  - rejects invalid explicit OpenCode syntax
  - rejects surrounding whitespace for explicit OpenCode models
  - rejects OpenCode `reasoning_effort`
  - builds resumed default OpenCode command
  - builds resumed explicit OpenCode command
  - asserts both `cwd` and `--dir` use the requested work folder
- `src/__tests__/parsers.test.ts`
  - parses single-step OpenCode output
  - parses multi-step OpenCode output and returns the last completed step
  - resets the current-step buffer on each `step_start`
  - parses `session_id`, `tokens`, and `cost`
  - returns partial output when text exists without `step_finish`
  - ignores malformed lines
  - returns `null` when no useful OpenCode event exists
- `src/__tests__/cli-utils.test.ts`
  - doctor includes OpenCode
  - `OPENCODE_CLI_NAME` override works

### Integration and contract tests

- `src/__tests__/cli-process-service.test.ts`
  - detached process path parses OpenCode stdout-only output
  - failed run preserves raw stdout/stderr even when some OpenCode output is parseable
  - detached failed run persists terminal status and non-zero exit code
- `src/__tests__/mcp-contract.test.ts`
  - OpenCode initial run
  - OpenCode resumed run with `model: "opencode"`
  - OpenCode resumed run with `model: "oc-<provider/model>"`
  - OpenCode rejects `reasoning_effort`
  - `models`/description output references OpenCode consistently
  - failed MCP-backed OpenCode run preserves raw stdout/stderr in compact and verbose result modes
- `src/__tests__/app-cli.test.ts`
  - help text includes OpenCode syntax
  - `ai-cli models` payload includes machine-readable OpenCode metadata
  - doctor output includes OpenCode
- `src/__tests__/cli-bin-smoke.test.ts`
  - smoke output includes OpenCode
- direct helper tests for foreground tools
  - add `src/__tests__/cli-direct.test.ts` for `src/cli.ts`
  - add `src/__tests__/cli-parse-direct.test.ts` for `src/cli-parse.ts`
  - assert `cli.run --help` includes OpenCode model syntax and examples
  - assert `cli.run.parse --help` includes `--agent opencode`
  - assert `cli.run.parse --agent opencode` dispatches to the OpenCode parser
- reusable OpenCode mock helper
  - add a shared helper such as `src/__tests__/utils/opencode-mock.ts` or a script factory beside the existing test utilities
  - helper should generate a mock `opencode` executable that can cover:
    - initial run
    - resumed run via `--session`
    - explicit model via `--model`
    - multi-step stdout event streams
    - failed runs that emit both parseable stdout and meaningful stderr
  - reuse the same helper from `mcp-contract`, `cli-process-service`, `e2e`, and direct `cli.run` tests instead of hand-rolling per-suite scripts

### Existing suites that must also be updated

- `src/__tests__/validation.test.ts`
  - runtime validation rejects malformed `oc-` values and OpenCode `reasoning_effort`
- `src/__tests__/server.test.ts`
  - server exports and doctor-related behavior include OpenCode binary detection
- `src/__tests__/e2e.test.ts`
  - tool registration and mocked end-to-end flows include OpenCode-facing descriptions and at least one OpenCode run/resume path
  - existing non-OpenCode detached backend expectations remain unchanged after OpenCode-specific exit-status capture is added

## Documentation Updates

- Add OpenCode to product description and supported backends
- Document `OPENCODE_CLI_NAME`
- Document model syntax:
  - `opencode`
  - `oc-<provider/model>`
- Document session semantics:
  - OpenCode resume is in-place
  - OpenCode resumed runs may also specify an explicit `oc-<provider/model>`
- Note that OpenCode models are not statically enumerated by this project and should be discovered with `opencode models`

## Implementation Sequence

1. Introduce shared type widening and binary discovery first.
   Update `AgentType`, `CliCommand.agent`, `CliBinaryName`, `StoredProcess.toolType`, and the shared `cliPaths` type together so later patches do not compile in a half-widened state.
   Verification gate: `npx tsc --noEmit` and targeted `vitest` for `cli-utils`, `server`, and `app-cli`.
2. Implement model validation, routing, OpenCode command construction, and explicit `reasoning_effort` rejection.
   Verification gate: `npx tsc --noEmit` and targeted `vitest` for `cli-builder`, `validation`, and direct `cli.run` helper tests.
3. Implement detached exit-status capture for `CliProcessService` and add the shared OpenCode mock helper used by contract, integration, and direct helper tests.
   Verification gate: `npx tsc --noEmit` and targeted `vitest` for `cli-process-service`, `cli-direct`, and helper-backed detached-run tests that assert persisted failed/completed status.
4. Implement `parseOpenCodeOutput()`, failed-run raw-output preservation, and parser dispatch in `ProcessService`, `CliProcessService`, `buildProcessResult()`, and `src/cli-parse.ts`.
   Verification gate: `npx tsc --noEmit` and targeted `vitest` for `parsers`, `cli-process-service`, `cli-parse-direct`, and `mcp-contract`.
5. Update `getModelsPayload()`, supported-model descriptions, doctor output, MCP descriptions, CLI help text, and README files.
   Verification gate: `npx tsc --noEmit` and targeted `vitest` for `app-cli`, `cli-bin-smoke`, `server`, `cli-direct`, and `e2e`.
6. Run the full regression set before merging.
   Minimum final gate:
   - `npx tsc --noEmit`
   - `npm test`
   - `npm run test:e2e`

## Risks

- OpenCode event schema may evolve, so the parser should tolerate unknown event types and malformed lines
- OpenCode model availability is environment-dependent, so validation must stay syntax-only after the `oc-<provider/model>` wrapper check
- If OpenCode emits important assistant content through non-`text` events, the first parser version may miss some output; tests should cover current observed output and the parser should fail soft to raw logs
- Resume semantics depend on OpenCode's `--session` behavior; mocks and tests should encode the chosen contract clearly so later contributors do not assume Claude-style fork behavior

## Acceptance Criteria

- `run` and `ai-cli run` can launch OpenCode using `model: "opencode"`
- `run` and `ai-cli run` can launch explicit OpenCode models using `model: "oc-<provider/model>"`
- resumed OpenCode runs are documented and implemented as in-place resume
- resumed OpenCode runs allow `session_id` with either `opencode` or `oc-<provider/model>`
- `reasoning_effort` is rejected explicitly for OpenCode
- `get_result` and `wait` return parsed `message` and `session_id` for successful OpenCode runs
- failed OpenCode runs always preserve raw `stdout` and `stderr`, and compact failed results do not hide stderr behind parsed assistant output
- detached `ai-cli`-managed OpenCode runs persist terminal exit metadata so non-zero exits are surfaced as `failed`, not silently treated as `completed`
- `ai-cli models` exposes OpenCode machine-readably with this exact backward-compatible extension:
  - `opencode: ["opencode"]`
  - `dynamicModelBackends.opencode.explicitPrefix === "oc-"`
  - `dynamicModelBackends.opencode.explicitPattern === "oc-<provider/model>"`
  - `dynamicModelBackends.opencode.discoveryCommand === "opencode models"`
  - `dynamicModelBackends.opencode.modelsAreDynamic === true`
- `cli.run` and `cli.run.parse` help/usage text and direct helper tests reflect OpenCode support
- doctor/help/docs/tests all reflect OpenCode support
