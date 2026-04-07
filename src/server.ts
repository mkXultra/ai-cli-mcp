#!/usr/bin/env node
export { debugLog, findClaudeCli, findCodexCli, findForgeCli, findGeminiCli } from './cli-utils.js';
export { resolveModelAlias } from './cli-builder.js';
export { ClaudeCodeServer, runMcpServer, spawnAsync } from './app/mcp.js';

import { runMcpServer } from './app/mcp.js';

if (!process.env.VITEST) {
  runMcpServer().catch(console.error);
}
