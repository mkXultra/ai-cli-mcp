# Development Guide

## Local Setup

```bash
# Clone the repository
git clone https://github.com/mkXultra/claude-code-mcp.git
cd claude-code-mcp

# Install dependencies
npm install

# Build the project
npm run build

# Development mode with auto-reloading
npm run dev
```

## Testing

The project includes comprehensive test suites:

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run e2e tests (with mocks)
npm run test:e2e

# Run e2e tests locally (requires Claude CLI)
npm run test:e2e:local

# Watch mode for development
npm run test:watch

# Coverage report
npm run test:coverage
```

For detailed testing documentation, see our [E2E Testing Guide](./e2e-testing.md).

## Manual Testing with MCP Inspector

You can manually test the MCP server using the Model Context Protocol Inspector:

```bash
# Build the project first
npm run build

# Start the MCP Inspector with the server
npx @modelcontextprotocol/inspector node dist/server.js
```

This will open a web interface where you can:
1. View all available tools (`run`, `list_processes`, `get_result`, `kill_process`)
2. Test each tool with different parameters
3. Test different AI models including:
   - Claude models: `sonnet`, `sonnet[1m]`, `opus`, `opusplan`, `haiku`
   - Codex models: `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.1-codex-mini`, `gpt-5.1-codex-max`, `gpt-5.2`, `gpt-5.1`, `gpt-5.1-codex`, `gpt-5-codex`, `gpt-5-codex-mini`, `gpt-5`
   - Gemini models: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-3-pro-preview`, `gemini-3-flash-preview`

Example test: Select the `run` tool and provide:
- `prompt`: "What is 2+2?"
- `workFolder`: "/tmp"
- `model`: "gemini-2.5-flash"

## Configuration via Environment Variables

The server's behavior can be customized using these environment variables:

- `CLAUDE_CLI_PATH`: Absolute path to the Claude CLI executable.
  - Default: Checks `~/.claude/local/claude`, then falls back to `claude` (expecting it in PATH).
- `MCP_CLAUDE_DEBUG`: Set to `true` for verbose debug logging from this MCP server. Default: `false`.

These can be set in your shell environment or within the `env` block of your `mcp.json` server configuration (though the `env` block in `mcp.json` examples was removed for simplicity, it's still a valid way to set them for the server process if needed).

## Contributing

Contributions are welcome!

Submit issues and pull requests to the [GitHub repository](https://github.com/mkXultra/claude-code-mcp).
