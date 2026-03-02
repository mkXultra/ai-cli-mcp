# Contributing

## Development Setup

```bash
git clone https://github.com/mkXultra/ai-cli-mcp.git
cd ai-cli-mcp
npm install
npm run build
```

## Testing

```bash
# Run all tests
npm test

# Unit tests only
npm run test:unit

# E2E tests (with mocks)
npm run test:e2e

# E2E tests locally (requires Claude CLI)
npm run test:e2e:local

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

## Manual Testing with MCP Inspector

```bash
npm run build
npx @modelcontextprotocol/inspector node dist/server.js
```

## CLI Direct Execution

Run AI CLI tools directly from the terminal (foreground, no MCP server):

```bash
npm run -s cli.run -- --model sonnet --workFolder /tmp --prompt "hello"
```

See [docs/development.md](docs/development.md#cli-direct-execution-clirun) for full options.

## Local Development with npm link

```bash
npm install
npm run build
npm link
```

Then use `ai-cli-mcp` command globally.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CLAUDE_CLI_NAME` | Claude CLI binary name or absolute path |
| `CODEX_CLI_NAME` | Codex CLI binary name or absolute path |
| `GEMINI_CLI_NAME` | Gemini CLI binary name or absolute path |
| `MCP_CLAUDE_DEBUG` | Enable debug logging (`true`/`false`) |

## Release Process

See [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) for release instructions.

Uses semantic-release with Conventional Commits:
- `fix:` → patch release
- `feat:` → minor release
- `feat!:` or `BREAKING CHANGE:` → major release

## License

MIT
