# AI CLI MCP Server

[![npm package](https://img.shields.io/npm/v/ai-cli-mcp)](https://www.npmjs.com/package/ai-cli-mcp)
[![View changelog](https://img.shields.io/badge/Explore%20Changelog-brightgreen)](/CHANGELOG.md)

[🇯🇵 日本語のREADMEはこちら](./README.ja.md)

> **📦 Package Migration Notice**: This package was formerly `@mkxultra/claude-code-mcp` and has been renamed to `ai-cli-mcp` to reflect its expanded support for multiple AI CLI tools.

An MCP (Model Context Protocol) server that allows running AI CLI tools (Claude, Codex, Gemini, Forge, and OpenCode) in background processes with automatic permission handling.

Did you notice that Cursor sometimes struggles with complex, multi-step edits or operations? This server, with its powerful unified `run` tool, enables multiple AI agents to handle your coding tasks more effectively.

## Demo

[![Demo](docs/assets/demo.gif)](https://github.com/mkXultra/ai-cli-mcp/releases/download/v2.11.0/demo.mp4)

## Overview

This MCP server provides tools that can be used by LLMs to interact with AI CLI tools. When integrated with MCP clients, it allows LLMs to:

- Run Claude CLI with all permissions bypassed (using `--dangerously-skip-permissions`)
- Execute Codex CLI with automatic approval mode (using `--full-auto`)
- Execute Gemini CLI with automatic approval mode (using `-y`)
- Execute Forge CLI in non-interactive mode (using `forge -C <workFolder> -p <prompt>`)
- Execute OpenCode in non-interactive JSON mode (using `opencode run --format json --dir <workFolder> <prompt>`)
- Support multiple AI models: Claude (sonnet, sonnet[1m], opus, opusplan, haiku), Codex (gpt-5.4, gpt-5.3-codex, gpt-5.2-codex, gpt-5.1-codex-mini, gpt-5.1-codex-max, gpt-5.2, gpt-5.1, gpt-5.1-codex, gpt-5-codex, gpt-5-codex-mini, gpt-5), Gemini (gemini-2.5-pro, gemini-2.5-flash, gemini-3.1-pro-preview, gemini-3-pro-preview, gemini-3-flash-preview), Forge (`forge`), and OpenCode (`opencode` plus explicit `oc-<provider/model>` wrappers such as `oc-openai/gpt-5.4`)
- Manage background processes with PID tracking
- Parse and return structured outputs from both tools

### Usage Example (Advanced Parallel Processing)

You can instruct your main agent to run multiple tasks in parallel like this:

> Launch agents for the following 3 tasks using acm mcp run:
> 1. Refactor `src/backend` code using `sonnet`
> 2. Create unit tests for `src/frontend` using `gpt-5.2-codex`
> 3. Update docs in `docs/` using `gemini-2.5-pro`
>
> While they run, please update the TODO list. Once done, use the `wait` tool to wait for all completions and report the results together.

### Usage Example (Context Caching & Sharing)

You can reuse heavy context (like large codebases) using session IDs to save costs while running multiple tasks.

> 1. First, use `acm mcp run` with `opus` to read all files in `src/` and understand the project structure.
> 2. Use the `wait` tool to wait for completion and retrieve the `session_id` from the result.
> 3. Using that `session_id`, run the following two tasks in parallel with `acm mcp run`:
>    - Create refactoring proposals for `src/utils` using `sonnet`
>    - Add architecture documentation to `README.md` using `gpt-5.2-codex`
> 4. Finally, `wait` again to combine both results.

[![Session Resume Demo](docs/assets/demo-resume.gif)](https://github.com/mkXultra/ai-cli-mcp/releases/download/v2.11.0/demo-resume.mp4)

## Benefits

- **True Async Multitasking**: Agent execution happens in the background, returning control immediately. The calling AI can proceed with the next task or invoke another agent without waiting for completion.
- **CLI in CLI (Agent in Agent)**: Directly invoke powerful CLI tools like Claude Code or Codex from any MCP-supported IDE or CLI. This enables broader, more complex system operations and automation beyond host environment limitations.
- **Freedom from Model/Provider Constraints**: Freely select and combine the "strongest" or "most cost-effective" models from Claude, Codex (GPT), Gemini, and Forge without being tied to a specific ecosystem.

## Prerequisites

The only prerequisite is that the AI CLI tools you want to use are locally installed and correctly configured.

- **Claude Code**: `claude doctor` passes, and execution with `--dangerously-skip-permissions` is approved (you must run it manually once to login and accept terms).
- **Codex CLI** (Optional): Installed and initial setup (login etc.) completed.
- **Gemini CLI** (Optional): Installed and initial setup (login etc.) completed.
- **Forge CLI** (Optional): Installed and initial setup completed.
- **OpenCode** (Optional): Installed and configured. This integration uses `opencode run --format json`, and explicit provider/model selection follows the `oc-<provider/model>` wrapper syntax exposed by `ai-cli models`.

## Installation & Usage

There are now two primary ways to use this package:

- `ai-cli-mcp`: MCP server entrypoint
- `ai-cli`: human-facing CLI for background AI runs

### MCP usage with `npx`

The recommended way to use the MCP server is via `npx`.

#### Using npx in your MCP configuration:

```json
    "ai-cli-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "ai-cli-mcp@latest"
      ]
    },
```

#### Using Claude CLI mcp add command:

```bash
claude mcp add ai-cli '{"name":"ai-cli","command":"npx","args":["-y","ai-cli-mcp@latest"]}'
```

### Human CLI usage with global install

If you want to use the production CLI directly from your shell, install the package globally:

```bash
npm install -g ai-cli-mcp
```

This exposes both commands:

- `ai-cli`
- `ai-cli-mcp`

Examples:

```bash
ai-cli doctor
ai-cli models
ai-cli run --cwd "$PWD" --model sonnet --prompt "summarize this repository"
ai-cli run --cwd "$PWD" --model opencode --prompt "summarize this repository with OpenCode defaults"
ai-cli run --cwd "$PWD" --model oc-openai/gpt-5.4 --session-id ses_123 --prompt "continue this session with an explicit OpenCode model"
ai-cli ps
ai-cli result 12345
ai-cli result 12345 --verbose
ai-cli wait 12345 --timeout 300
ai-cli wait 12345 --verbose
ai-cli kill 12345
ai-cli cleanup
ai-cli-mcp
```

### Human CLI usage with `npx`

Because the published package name is still `ai-cli-mcp`, the shortest `npx` form for the CLI is:

```bash
npx -y --package ai-cli-mcp@latest ai-cli run --cwd "$PWD" --model sonnet --prompt "hello"
npx -y --package ai-cli-mcp@latest ai-cli run --cwd "$PWD" --model oc-openai/gpt-5.4 --prompt "hello from OpenCode"
```

## Important First-Time Setup

### For Claude CLI:

**Before the MCP server can use Claude, you must first run the Claude CLI manually once with the `--dangerously-skip-permissions` flag, login and accept the terms.**

```bash
npm install -g @anthropic-ai/claude-code
claude --dangerously-skip-permissions
```

Follow the prompts to accept. Once this is done, the MCP server will be able to use the flag non-interactively.

### For Codex CLI:

**For Codex, ensure you're logged in and have accepted any necessary terms:**

```bash
codex login
```

### For Gemini CLI:

**For Gemini, ensure you're logged in and have configured your credentials:**

```bash
gemini auth login
```

macOS might ask for folder permissions the first time any of these tools run. If the first run fails, subsequent runs should work.

## CLI Commands

`ai-cli` currently supports:

- `run`
- `ps`
- `result`
- `wait`
- `kill`
- `cleanup`
- `doctor`
- `models`
- `mcp`

Example flow:

```bash
ai-cli doctor
ai-cli models
ai-cli run --cwd "$PWD" --model codex-ultra --prompt "fix failing tests"
ai-cli run --cwd "$PWD" --model opencode --session-id ses_existing --prompt "continue this OpenCode session"
ai-cli run --cwd "$PWD" --model oc-openai/gpt-5.4 --prompt "run with an explicit OpenCode backend model"
ai-cli ps
ai-cli wait 12345
ai-cli wait 12345 --verbose
ai-cli result 12345
ai-cli result 12345 --verbose
ai-cli cleanup
```

`run` accepts `--cwd` as the primary working-directory flag and also accepts the older aliases `--workFolder` / `--work-folder` for compatibility.

OpenCode model selection accepts either:

- `opencode` for the CLI's configured default model
- `oc-<provider/model>` for an explicit OpenCode provider/model, for example `oc-openai/gpt-5.4`

`ai-cli models` exposes OpenCode machine-readably via `opencode: ["opencode"]` plus `dynamicModelBackends.opencode`, which points users to `opencode models` for backend-native discovery.

`doctor` checks only binary existence and path resolution. It does not verify login state or terms acceptance.

## CLI State Storage

Background CLI runs are stored under:

```text
~/.local/state/ai-cli/cwds/<normalized-cwd>/<pid>/
```

Each PID directory contains:

- `meta.json`
- `stdout.log`
- `stderr.log`
- `exit-status.json` for detached OpenCode runs

Use `ai-cli cleanup` to remove completed and failed runs. Running processes are preserved.

## Known Limitation

Detached `ai-cli` runs persist natural exit status for OpenCode-backed runs, including failed exit codes used to preserve raw OpenCode stdout/stderr in result output. Other detached backends still keep the pre-existing limitation: naturally finished runs may be surfaced as completed without a reliable persisted exit code until broader exit tracking is added.

## Connecting to Your MCP Client

After setting up the server, add the configuration to your MCP client's settings file (e.g., `mcp.json` for Cursor, `mcp_config.json` for Windsurf).

If the file doesn't exist, create it and add the `ai-cli-mcp` configuration.

## Tools Provided

This server exposes the following tools:

### `run`

Executes a prompt using Claude CLI, Codex CLI, Gemini CLI, Forge CLI, or OpenCode. The appropriate CLI is automatically selected based on the model name.

**Arguments:**
- `prompt` (string, optional): The prompt to send to the AI agent. Either `prompt` or `prompt_file` is required.
- `prompt_file` (string, optional): Path to a file containing the prompt. Either `prompt` or `prompt_file` is required. Can be absolute path or relative to `workFolder`.
- `workFolder` (string, required): The working directory for the CLI execution. Must be an absolute path.
**Models:**
- **Ultra Aliases:** `claude-ultra` (defaults to high effort), `codex-ultra` (defaults to xhigh reasoning), `gemini-ultra`
- Claude: `sonnet`, `sonnet[1m]`, `opus`, `opusplan`, `haiku`
- Codex: `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.1-codex-mini`, `gpt-5.1-codex-max`, `gpt-5.2`, `gpt-5.1`, `gpt-5`
- Gemini: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-3.1-pro-preview`, `gemini-3-pro-preview`, `gemini-3-flash-preview`
- Forge: `forge`
- OpenCode: `opencode` for the configured default backend model, plus explicit wrappers like `oc-openai/gpt-5.4`
- `reasoning_effort` (string, optional): Reasoning control for Claude and Codex. Claude uses `--effort` (allowed: "low", "medium", "high"). Codex uses `model_reasoning_effort` (allowed: "low", "medium", "high", "xhigh"). Gemini, Forge, and OpenCode do not support `reasoning_effort`.
- `session_id` (string, optional): Optional session ID to resume a previous session. Supported for Claude, Codex, Gemini, Forge, and OpenCode. OpenCode resumes in place via `--session` and may also be combined with an explicit `oc-<provider/model>` selection.

### `wait`

Waits for multiple AI agent processes to complete and returns their combined results. Blocks until all specified PIDs finish or a timeout occurs.

By default, each returned result item uses the compact shape shared with `get_result(verbose: false)`: operational fields such as `pid`, `agent`, `status`, `exitCode`, `model`, parsed output such as `agentOutput`, and top-level `session_id` when available. Set `verbose: true` to include full metadata like `startTime`, `workFolder`, `prompt`, and detailed parsed output such as `agentOutput.tools`.

**Arguments:**
- `pids` (array of numbers, required): List of process IDs to wait for (returned by the `run` tool).
- `timeout` (number, optional): Maximum wait time in seconds. Defaults to 180 (3 minutes).
- `verbose` (boolean, optional): If `true`, each result item uses the full result shape. Defaults to `false`.

### `list_processes`

Lists all running and completed AI agent processes with their status, PID, and basic info.

### `get_result`

Gets the current output and status of an AI agent process by PID.

By default, this returns the compact result shape: operational fields such as `pid`, `agent`, `status`, `exitCode`, `model`, parsed output such as `agentOutput`, and top-level `session_id` when available. It omits metadata fields like `startTime`, `workFolder`, and `prompt`. Set `verbose: true` to return the full result shape including those metadata fields and detailed parsed output such as `agentOutput.tools`. If parsed output is unavailable or incomplete, the raw `stdout`/`stderr` fallback is preserved.

**Arguments:**
- `pid` (number, required): The process ID returned by the `run` tool.
- `verbose` (boolean, optional): If `true`, returns the full result shape. Defaults to `false`.

### `kill_process`

Terminates a running AI agent process by PID.

**Arguments:**
- `pid` (number, required): The process ID to terminate.

## Troubleshooting

- **"Command not found" (claude-code-mcp):** If installed globally, ensure the npm global bin directory is in your system's PATH. If using `npx`, ensure `npx` itself is working.
- **"Command not found" (`ai-cli`):** If installed globally, ensure your npm global bin directory is in `PATH`. If using `npx`, use `npx -y --package ai-cli-mcp@latest ai-cli ...`.
- **"Command not found" (claude or ~/.claude/local/claude):** Ensure the Claude CLI is installed correctly. Run `claude/doctor` or check its documentation.
- **Permissions Issues:** Make sure you've run the "Important First-Time Setup" step.
- **JSON Errors from Server:** If `MCP_CLAUDE_DEBUG` is `true`, error messages or logs might interfere with MCP's JSON parsing. Set to `false` for normal operation.
- **ESM/Import Errors:** Ensure you are using Node.js v20 or later.

## Contributing

For development setup, testing, and contribution guidelines, see the [Development Guide](./docs/development.md).

## Advanced Configuration (Optional)

Normally not required, but useful for customizing CLI paths or debugging.

- `CLAUDE_CLI_NAME`: Override the Claude CLI binary name or provide an absolute path (default: `claude`)
- `CODEX_CLI_NAME`: Override the Codex CLI binary name or provide an absolute path (default: `codex`)
- `GEMINI_CLI_NAME`: Override the Gemini CLI binary name or provide an absolute path (default: `gemini`)
- `FORGE_CLI_NAME`: Override the Forge CLI binary name or provide an absolute path (default: `forge`)
- `OPENCODE_CLI_NAME`: Override the OpenCode CLI binary name or provide an absolute path (default: `opencode`)
- `MCP_CLAUDE_DEBUG`: Enable debug logging (set to `true` for verbose output)

**CLI Name Specification:**
- Command name only: `CLAUDE_CLI_NAME=claude-custom`
- Absolute path: `CLAUDE_CLI_NAME=/path/to/custom/claude`
*Relative paths are not supported.*

### Example with custom CLI binaries:

```json
    "ai-cli-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "ai-cli-mcp@latest"
      ],
      "env": {
        "CLAUDE_CLI_NAME": "claude-custom",
        "CODEX_CLI_NAME": "codex-custom",
        "OPENCODE_CLI_NAME": "opencode-custom"
      }
    },
```

## License

MIT
