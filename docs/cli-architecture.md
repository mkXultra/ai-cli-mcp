# AI CLI Architecture Plan

## Goal

`ai-cli-mcp` package will expose two global commands:

- `ai-cli`: human-facing production CLI
- `ai-cli-mcp`: MCP server entrypoint for backward compatibility

The package name stays `ai-cli-mcp` for now. We do not introduce a daemon. We keep the product as a thin wrapper over Claude Code, Codex CLI, and Gemini CLI.

## Non-Goals

- Renaming the npm package in this phase
- Introducing a long-running background daemon
- Introducing a new public job identifier such as `run_id`
- Making the CLI responsible for deep process orchestration beyond launching and observing AI CLI processes

## Product Shape

### `ai-cli`

`ai-cli` is the primary CLI for humans.

Supported commands:

- `ai-cli run`
- `ai-cli wait`
- `ai-cli ps`
- `ai-cli result`
- `ai-cli kill`
- `ai-cli cleanup`
- `ai-cli models`
- `ai-cli doctor`
- `ai-cli mcp`

Behavior:

- Running `ai-cli` with no subcommand prints help
- Public process identity is `pid`
- `--cwd` is the working directory flag
- Output format should stay close to MCP responses

### `ai-cli-mcp`

`ai-cli-mcp` remains the MCP-focused command.

Behavior:

- Running `ai-cli-mcp` with no arguments starts the MCP server
- This command exists for compatibility with existing users and MCP configurations

## Public Command Semantics

### `ai-cli run`

Starts the target AI CLI in the background and returns immediately.

Properties:

- Returns MCP-like JSON including `pid`, `status`, `agent`, and `message`
- Uses `pid` as the public identifier
- Spawns a thin detached wrapper that runs the actual Claude/Codex/Gemini/Forge/OpenCode process
- Redirects `stdout` and `stderr` to files
- Persists natural process exit status to `exit-status.json`

### `ai-cli wait`

Waits until all given PIDs are no longer running.

Properties:

- Input is one or more `pid` values
- Timeout is supported
- Response format follows MCP `wait` as closely as possible
- Returns a result array, same direction as MCP

### `ai-cli ps`

Lists tracked runs with minimal information.

Properties:

- Output includes `pid`, `agent`, and `status`
- Initial scope is intentionally minimal

### `ai-cli result`

Reads saved output and returns parsed results.

Properties:

- Behavior should stay close to MCP `get_result`
- Parsed output is preferred
- Falls back to raw output when parsing fails or output is incomplete

### `ai-cli kill`

Sends `SIGTERM` to the given PID.

Properties:

- Public API is intentionally PID-based
- Users may also kill processes manually outside the tool

### `ai-cli cleanup`

Removes tracked process state for runs that are no longer running.

Properties:

- Removes completed and failed PID directories
- Keeps running processes intact
- Removes empty per-cwd directories after cleanup

### `ai-cli doctor`

Checks whether supported AI CLI binaries are available.

Properties:

- Scope is binary existence/path resolution only
- It does not verify login or acceptance state

### `ai-cli models`

Returns the supported model list and aliases.

Properties:

- Behavior should stay close to MCP-supported model documentation
- Static model definitions are acceptable in this phase

### `ai-cli mcp`

Starts the MCP server from the `ai-cli` command.

Properties:

- Allows one package to support both direct CLI usage and MCP usage

## Entrypoints

Planned package bin layout:

```json
{
  "bin": {
    "ai-cli": "dist/bin/ai-cli.js",
    "ai-cli-mcp": "dist/bin/ai-cli-mcp.js"
  }
}
```

Planned source layout:

```text
src/
  bin/
    ai-cli.ts
    ai-cli-mcp.ts
  app/
    cli.ts
    mcp.ts
```

Responsibilities:

- `src/bin/ai-cli.ts`: thin CLI entrypoint
- `src/bin/ai-cli-mcp.ts`: thin MCP entrypoint
- `src/app/cli.ts`: subcommand parsing and dispatch for `ai-cli`
- `src/app/mcp.ts`: MCP server bootstrap

## Backend Architecture

The core implementation should be shared between CLI and MCP.

Suggested internal boundaries:

- `cli-builder`
  - resolves model aliases
  - validates input
  - builds the real Claude/Codex/Gemini command
- `runner`
  - spawns the actual AI CLI process
  - redirects `stdout` and `stderr` to files
- `process-store`
  - stores tracked process metadata
  - exact path and file format are intentionally deferred
- `process-service`
  - shared use cases for `run`, `wait`, `ps`, `result`, and `kill`
- `parsers`
  - parses saved output into structured results

## PID-Based Design Decision

The public interface stays PID-based on purpose.

Rationale:

- This CLI is a thin wrapper over existing AI CLI tools
- PID is already the native OS process identifier
- Users can inspect or terminate processes with normal Unix tooling
- We do not want to introduce a synthetic public job ID in this phase

Implication:

- Public commands use `pid`
- Internal storage may store additional metadata if needed
- PID remains the only required identifier at the product surface

## Background Execution Strategy

The first production CLI implementation uses direct process spawning with file redirection.

Approach:

- Spawn a thin detached wrapper process
- Let the wrapper run the actual AI CLI process
- Redirect `stdout` to a file
- Redirect `stderr` to a file
- Persist enough metadata to support `wait`, `ps`, `result`, and `kill`
- Persist natural process exit status to `exit-status.json`

Why this approach:

- Lighter than introducing a long-running daemon
- Keeps the CLI close to Unix process semantics
- Avoids worker-child termination complexity
- Keeps migration from the current MCP server relatively simple

## MCP Compatibility Plan

MCP functionality stays in the project and should be preserved.

Compatibility goals:

- Keep current MCP tool names
- Keep current response shape as much as practical
- Reuse the same backend logic as the new CLI where possible

Target mapping:

- MCP `run` -> shared process service `run`
- MCP `wait` -> shared process service `wait`
- MCP `list_processes` -> shared process service `ps`
- MCP `get_result` -> shared process service `result`
- MCP `kill_process` -> shared process service `kill`

## Implementation Order

1. Split the current `src/server.ts` responsibilities into MCP surface and shared process logic
2. Introduce new bin entrypoints for `ai-cli` and `ai-cli-mcp`
3. Add `ai-cli` subcommand parsing and help output
4. Implement direct background spawning with stdout/stderr file redirection
5. Implement CLI commands: `run`, `wait`, `ps`, `result`, `kill`
6. Add `models`, `doctor`, and `mcp`
7. Rewire MCP handlers to the same shared backend

## Open Items Deferred

The following items are intentionally deferred:

- state directory path
- file naming scheme
- metadata file schema
- retention and cleanup policy
- exact raw output access patterns
- Windows-specific process handling details
