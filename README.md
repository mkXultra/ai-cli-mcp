# AI CLI MCP Server

[![npm package](https://img.shields.io/npm/v/ai-cli-mcp)](https://www.npmjs.com/package/ai-cli-mcp)
[![View changelog](https://img.shields.io/badge/Explore%20Changelog-brightgreen)](/CHANGELOG.md)

[🇯🇵 日本語のREADMEはこちら](./README.ja.md)

> **📦 Package Migration Notice**: This package was formerly `@mkxultra/claude-code-mcp` and has been renamed to `ai-cli-mcp` to reflect its expanded support for multiple AI CLI tools.

An MCP (Model Context Protocol) server that allows running AI CLI tools (Claude, Codex, and Gemini) in background processes with automatic permission handling.

Did you notice that Cursor sometimes struggles with complex, multi-step edits or operations? This server, with its powerful unified `run` tool, enables multiple AI agents to handle your coding tasks more effectively.

## Overview

This MCP server provides tools that can be used by LLMs to interact with AI CLI tools. When integrated with MCP clients, it allows LLMs to:

- Run Claude CLI with all permissions bypassed (using `--dangerously-skip-permissions`)
- Execute Codex CLI with automatic approval mode (using `--full-auto`)
- Execute Gemini CLI with automatic approval mode (using `-y`)
- Support multiple AI models: Claude (sonnet, sonnet[1m], opus, opusplan, haiku), Codex (gpt-5.3-codex, gpt-5.2-codex, gpt-5.1-codex-mini, gpt-5.1-codex-max, gpt-5.2, gpt-5.1, gpt-5.1-codex, gpt-5-codex, gpt-5-codex-mini, gpt-5), and Gemini (gemini-2.5-pro, gemini-2.5-flash, gemini-3.1-pro-preview, gemini-3-pro-preview, gemini-3-flash-preview)
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

## Benefits

- **True Async Multitasking**: Agent execution happens in the background, returning control immediately. The calling AI can proceed with the next task or invoke another agent without waiting for completion.
- **CLI in CLI (Agent in Agent)**: Directly invoke powerful CLI tools like Claude Code or Codex from any MCP-supported IDE or CLI. This enables broader, more complex system operations and automation beyond host environment limitations.
- **Freedom from Model/Provider Constraints**: Freely select and combine the "strongest" or "most cost-effective" models from Claude, Codex (GPT), and Gemini without being tied to a specific ecosystem.

## Prerequisites

The only prerequisite is that the AI CLI tools you want to use are locally installed and correctly configured.

- **Claude Code**: `claude doctor` passes, and execution with `--dangerously-skip-permissions` is approved (you must run it manually once to login and accept terms).
- **Codex CLI** (Optional): Installed and initial setup (login etc.) completed.
- **Gemini CLI** (Optional): Installed and initial setup (login etc.) completed.

## Installation & Usage

The recommended way to use this server is by installing it by using `npx`.

### Using npx in your MCP configuration:

```json
    "ai-cli-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "ai-cli-mcp@latest"
      ]
    },
```

### Using Claude CLI mcp add command:

```bash
claude mcp add ai-cli '{"name":"ai-cli","command":"npx","args":["-y","ai-cli-mcp@latest"]}'
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

## Connecting to Your MCP Client

After setting up the server, add the configuration to your MCP client's settings file (e.g., `mcp.json` for Cursor, `mcp_config.json` for Windsurf).

If the file doesn't exist, create it and add the `ai-cli-mcp` configuration.

## Tools Provided

This server exposes the following tools:

### `run`

Executes a prompt using Claude CLI, Codex CLI, or Gemini CLI. The appropriate CLI is automatically selected based on the model name.

**Arguments:**
- `prompt` (string, optional): The prompt to send to the AI agent. Either `prompt` or `prompt_file` is required.
- `prompt_file` (string, optional): Path to a file containing the prompt. Either `prompt` or `prompt_file` is required. Can be absolute path or relative to `workFolder`.
- `workFolder` (string, required): The working directory for the CLI execution. Must be an absolute path.
**Models:**
- **Ultra Aliases:** `claude-ultra`, `codex-ultra` (defaults to high-reasoning), `gemini-ultra`
- Claude: `sonnet`, `sonnet[1m]`, `opus`, `opusplan`, `haiku`
- Codex: `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.1-codex-mini`, `gpt-5.1-codex-max`, `gpt-5.2`, `gpt-5.1`, `gpt-5`
- Gemini: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-3.1-pro-preview`, `gemini-3-pro-preview`, `gemini-3-flash-preview`
- `reasoning_effort` (string, optional): Codex only. Sets `model_reasoning_effort` (allowed: "low", "medium", "high", "xhigh").
- `session_id` (string, optional): Optional session ID to resume a previous session. Supported for: haiku, sonnet, opus, gemini-2.5-pro, gemini-2.5-flash, gemini-3.1-pro-preview, gemini-3-pro-preview, gemini-3-flash-preview.

### `wait`

Waits for multiple AI agent processes to complete and returns their combined results. Blocks until all specified PIDs finish or a timeout occurs.

**Arguments:**
- `pids` (array of numbers, required): List of process IDs to wait for (returned by the `run` tool).
- `timeout` (number, optional): Maximum wait time in seconds. Defaults to 180 (3 minutes).

### `list_processes`

Lists all running and completed AI agent processes with their status, PID, and basic info.

### `get_result`

Gets the current output and status of an AI agent process by PID.

**Arguments:**
- `pid` (number, required): The process ID returned by the `run` tool.

### `kill_process`

Terminates a running AI agent process by PID.

**Arguments:**
- `pid` (number, required): The process ID to terminate.

## Troubleshooting

- **"Command not found" (claude-code-mcp):** If installed globally, ensure the npm global bin directory is in your system's PATH. If using `npx`, ensure `npx` itself is working.
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
        "CODEX_CLI_NAME": "codex-custom"
      }
    },
```

## License

MIT
