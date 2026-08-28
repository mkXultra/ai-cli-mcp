import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function currentEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

describe('MCP server spawn failure isolation', () => {
  it('keeps serving requests after a CLI fails before receiving a PID', async () => {
    const missingCommand = join(process.cwd(), `missing-mcp-cli-${process.pid}-${Date.now()}`);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'src/server.ts'],
      cwd: process.cwd(),
      env: {
        ...currentEnvironment(),
        VITEST: '',
        CLAUDE_CLI_NAME: missingCommand,
        CODEX_CLI_NAME: missingCommand,
        GEMINI_CLI_NAME: missingCommand,
        FORGE_CLI_NAME: missingCommand,
        OPENCODE_CLI_NAME: missingCommand,
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'spawn-failure-test', version: '1.0.0' });

    try {
      await client.connect(transport);
      await expect(client.callTool({
        name: 'run',
        arguments: {
          prompt: 'startup failure test',
          workFolder: process.cwd(),
        },
      })).rejects.toThrow('Failed to start claude CLI process');

      const tools = await client.listTools();
      expect(tools.tools.some((tool) => tool.name === 'doctor')).toBe(true);
    } finally {
      await client.close();
    }
  });

  it.runIf(process.platform === 'win32')('runs a .cmd CLI through the stdio MCP server', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-cli-mcp-cmd-'));
    const fixtureDir = join(root, 'cmd fixture');
    const workFolder = join(root, 'work');
    mkdirSync(fixtureDir, { recursive: true });
    mkdirSync(workFolder, { recursive: true });
    const scriptPath = join(fixtureDir, 'mock-claude.cjs');
    const shimPath = join(fixtureDir, 'mock-claude.cmd');
    writeFileSync(
      scriptPath,
      `const args = process.argv.slice(2);\nconst promptIndex = args.indexOf('-p');\nconsole.log(JSON.stringify({ type: 'result', result: args[promptIndex + 1], is_error: false }));\n`,
    );
    writeFileSync(shimPath, `@ECHO off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'src/server.ts'],
      cwd: process.cwd(),
      env: {
        ...currentEnvironment(),
        VITEST: '',
        CLAUDE_CLI_NAME: shimPath,
        CODEX_CLI_NAME: shimPath,
        GEMINI_CLI_NAME: shimPath,
        FORGE_CLI_NAME: shimPath,
        OPENCODE_CLI_NAME: shimPath,
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'cmd-spawn-test', version: '1.0.0' });
    const prompt = 'MCP .cmd prompt & | ^ %PATH% " preserved';

    try {
      await client.connect(transport);
      const runResponse: any = await client.callTool({
        name: 'run',
        arguments: { prompt, workFolder },
      });
      const started = JSON.parse(runResponse.content[0].text);
      const waitResponse: any = await client.callTool({
        name: 'wait',
        arguments: { pids: [started.pid], timeout: 5, verbose: true },
      });
      const [result] = JSON.parse(waitResponse.content[0].text);

      expect(result).toMatchObject({
        pid: started.pid,
        agent: 'claude',
        status: 'completed',
        exitCode: 0,
        agentOutput: { result: prompt, is_error: false },
      });
    } finally {
      await client.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
