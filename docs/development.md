# Development Guide

## Local Setup

```bash
# Clone the repository
git clone https://github.com/mkXultra/ai-cli-mcp.git
cd ai-cli-mcp

# Install dependencies
npm install

# Build the project
npm run build

# Development mode with auto-reloading
npm run dev
```

## Project Structure

```
src/
├── server.ts          # MCP server — tool registration, process management, spawn
├── cli-builder.ts     # Pure function: CLI command assembly (model alias, validation, args)
├── cli.ts             # CLI entrypoint for foreground execution (npm run cli.run)
├── parsers.ts         # Output parsers for Claude / Codex / Gemini
└── __tests__/
    ├── cli-builder.test.ts
    ├── server.test.ts
    ├── parsers.test.ts
    ├── process-management.test.ts
    ├── validation.test.ts
    ├── wait.test.ts
    ├── model-alias.test.ts
    ├── version-print.test.ts
    ├── error-cases.test.ts
    └── e2e.test.ts
```

### Key modules

| Module | Role |
|--------|------|
| `cli-builder.ts` | `buildCliCommand()` — validates inputs (prompt, workFolder, model) and returns `{ cliPath, args, cwd, agent, prompt, resolvedModel }`. No MCP dependency; throws plain `Error`. |
| `server.ts` | MCP server. Calls `buildCliCommand()` inside `handleRun`, wraps errors in `McpError`, then spawns the process in the background. |
| `cli.ts` | Standalone CLI. Parses `process.argv`, calls `buildCliCommand()`, spawns the process in the **foreground**, parses output, and prints JSON to stdout. |
| `parsers.ts` | `parseClaudeOutput`, `parseCodexOutput`, `parseGeminiOutput` — parse CLI stdout into structured objects. |

## Testing

The project includes comprehensive test suites:

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Verify the published npm package contents
npm run test:package

# Run the deterministic PR/release gate used by GitHub Actions.
# This does not enable real external CLI runs by itself.
npm run test:release

# Run e2e tests (with mocks)
npm run test:e2e

# Run e2e tests locally (requires Claude CLI)
npm run test:e2e:local

# Run opt-in live E2E against real installed AI CLIs
ACM_LIVE_E2E=1 npm run test:live

# Select backends for live E2E. Use "all" for every supported backend.
ACM_LIVE_E2E=1 ACM_LIVE_E2E_AGENTS=claude,codex npm run test:live

# Include both ai-cli and MCP server surfaces.
ACM_LIVE_E2E=1 ACM_LIVE_E2E_SURFACE=all ACM_LIVE_E2E_AGENTS=claude,codex npm run test:live

# Watch mode for development
npm run test:watch

# Coverage report
npm run test:coverage
```

For detailed testing documentation, see our [E2E Testing Guide](./e2e-testing.md).

## CLI Direct Execution (`cli.run` / `cli.run.parse`)

MCP サーバーを経由せず、ターミナルから直接 AI CLI を実行できます。

### `cli.run` — 実行 (生出力)

CLI プロセスをフォアグラウンドで起動し、**生の stdout をそのまま出力**します。

```bash
# 基本
npm run -s cli.run -- --model sonnet --workFolder /tmp --prompt "hello"

# prompt file 指定
npm run -s cli.run -- --model gpt-5.2-codex --workFolder /path/to/project --prompt_file prompt.txt

# セッション再開
npm run -s cli.run -- --model sonnet --workFolder /tmp --prompt "continue" --session_id <id>

# Codex reasoning effort
npm run -s cli.run -- --model gpt-5.2-codex --workFolder /tmp --prompt "test" --reasoning_effort high
```

> **Tip:** `-s` (silent) で npm のスクリプトバナーを抑制します。付けないとリダイレクト時にバナーが混入します。

### `cli.run.parse` — 生出力のパース

`cli.run` の生出力を stdin から受け取り、構造化 JSON に変換して stdout に出力します。

```bash
# ファイル経由
npm run -s cli.run -- --model sonnet --workFolder /tmp --prompt "hi" > raw.txt
npm run -s cli.run.parse -- --agent claude < raw.txt

# パイプ
npm run -s cli.run -- --model sonnet --workFolder /tmp --prompt "hi" \
  | npm run -s cli.run.parse -- --agent claude
```

`--agent` は必須です: `claude`, `codex`, `gemini` のいずれかを指定してください。

## Manual Testing with MCP Inspector

You can manually test the MCP server using the Model Context Protocol Inspector:

```bash
# Build the project first
npm run build

# Start the MCP Inspector with the server
npx @modelcontextprotocol/inspector node dist/server.js
```

This will open a web interface where you can:
1. View all available tools (`run`, `list_processes`, `get_result`, `wait`, `peek`, `kill_process`, `cleanup_processes`, `doctor`, `models`)
2. Test each tool with different parameters
3. Test different AI models including:
   - Claude models: `sonnet`, `sonnet[1m]`, `opus`, `opusplan`, `haiku`
   - Codex models: `codex` for the CLI default, `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.1-codex-mini`, `gpt-5.1-codex-max`, `gpt-5.2`, `gpt-5.1`, `gpt-5.1-codex`, `gpt-5-codex`, `gpt-5-codex-mini`, `gpt-5`
   - Gemini models: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-3-pro-preview`, `gemini-3-flash-preview`

Example test: Select the `run` tool and provide:
- `prompt`: "What is 2+2?"
- `workFolder`: "/tmp"
- `model`: "gemini-2.5-flash"

## Configuration via Environment Variables

| Variable | Description |
|----------|-------------|
| `CLAUDE_CLI_NAME` | Claude CLI binary name or absolute path (default: `claude`) |
| `CODEX_CLI_NAME` | Codex CLI binary name or absolute path (default: `codex`) |
| `GEMINI_CLI_NAME` | Gemini CLI binary name or absolute path (default: `gemini`) |
| `MCP_CLAUDE_DEBUG` | Enable debug logging — `true` / `false` (default: `false`) |

These can be set in your shell environment or within the `env` block of your `mcp.json` server configuration.

## Contributing

Contributions are welcome!

Submit issues and pull requests to the [GitHub repository](https://github.com/mkXultra/ai-cli-mcp).
