#!/usr/bin/env node
import { runMcpServer } from '../app/mcp.js';

runMcpServer().catch((error: Error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
