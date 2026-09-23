import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { MCPTestClient } from './utils/mcp-client.js';

const exec = promisify(execFile);

describe.skipIf(process.platform === 'win32')('dynamic model public surfaces', () => {
  it.each(['cli', 'mcp'])('%s returns discovered model names and preserves fresh aliases', async (surface) => {
    const root = mkdtempSync(join(tmpdir(), 'acm-model-discovery-'));
    const script = join(root, 'models-cli');
    const log = join(root, 'calls.jsonl');
    const config = join(root, 'config.json');
    writeFileSync(config, '{}');
    writeFileSync(script, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[0] === '--list-models') {
  console.log('provider model context max-out thinking images');
  console.log('openai-codex gpt-6-astra 272K 128K yes yes');
} else if (args[0] === 'models') {
  console.log('custom/nested/model');
} else process.exit(1);
`, { mode: 0o755 });
    const env = { ...process.env, PI_CLI_NAME: script, OPENCODE_CLI_NAME: script, AI_CLI_CONFIG_PATH: config };
    const client = surface === 'mcp' ? new MCPTestClient(resolve('dist/bin/ai-cli-mcp.js'), env) : null;
    try {
      if (client) await client.connect();
      const models = async () => client
        ? JSON.parse((await client.callTool('models', {}))[0].text)
        : JSON.parse((await exec(process.execPath, [resolve('dist/bin/ai-cli.js'), 'models'], { env })).stdout);
      const first = await models();
      expect(first.pi).toEqual(['pi', 'pi-openai-codex/gpt-6-astra']);
      expect(first.opencode).toEqual(['opencode', 'oc-custom/nested/model']);
      for (const backend of ['pi', 'opencode']) {
        expect(first.dynamicModelBackends[backend].discovery).toMatchObject({ status: 'success', cached: false });
      }
      writeFileSync(config, JSON.stringify({ model_aliases: { 'pi-coding': { model: first.pi[1], reasoning_effort: 'high' } } }));
      const second = await models();
      expect(second.aliases).toContainEqual({ name: 'pi-coding', resolvesTo: first.pi[1], agent: 'pi', defaultReasoningEffort: 'high' });
      expect(second.dynamicModelBackends.pi.discovery.cached).toBe(surface === 'mcp');
      const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      expect(calls.filter(args => args[0] === '--list-models')).toHaveLength(surface === 'mcp' ? 1 : 2);
      expect(calls.filter(args => args[0] === 'models')).toHaveLength(surface === 'mcp' ? 1 : 2);
    } finally {
      if (client) await client.disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
