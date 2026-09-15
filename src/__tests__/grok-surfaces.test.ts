import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MCPTestClient } from './utils/mcp-client.js';

const exec = promisify(execFile);
const success = readFileSync(new URL('./fixtures/grok-messages.ndjson', import.meta.url), 'utf8');
const failure = readFileSync(new URL('./fixtures/grok-error.ndjson', import.meta.url), 'utf8');
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Deterministic real processes exercise both built public entry points, without credentials.
describe.skipIf(process.platform === 'win32')('Grok public surfaces', () => {
  it.each(['cli', 'mcp'])('%s supports lifecycle, observation windows, errors, aliases and tree cancellation', async (surface) => {
    const root = mkdtempSync(join(tmpdir(), 'grok-surface-'));
    const executable = join(root, 'grok-test');
    writeFileSync(executable, `#!${process.execPath}
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync('args.json', JSON.stringify(args));
const prompt = args.find(arg => arg.startsWith('--single='))?.slice('--single='.length) ?? args[args.indexOf('-p') + 1];
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  if (prompt === 'startup') { console.error('Session not found'); process.exit(1); }
  await wait(650);
  if (prompt === 'kill') {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
    fs.writeFileSync('tool.pid', String(child.pid));
    console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'Tool running'}]}}));
    setInterval(() => {}, 1000); return;
  }
  const lines = (prompt === 'partial' ? ${JSON.stringify(failure)} : ${JSON.stringify(success)}).trim().split('\\n');
  for (const line of lines) {
    const cut = Math.floor(line.length / 2);
    process.stdout.write(line.slice(0, cut)); await wait(20);
    process.stdout.write(line.slice(cut) + '\\n'); await wait(200);
  }
  if (prompt === 'partial') { console.error('Turn limit reached'); process.exit(1); }
})();
`, { mode: 0o755 });
    writeFileSync(join(root, 'config.json'), JSON.stringify({ model_aliases: { grok: { model: 'oc-xai/grok-4' }, 'grok-test-alias': { model: 'grok-4.6', reasoning_effort: 'xhigh' } } }));
    const env = { ...process.env, GROK_CLI_NAME: executable, CLAUDE_CLI_NAME: executable, AI_CLI_CONFIG_PATH: join(root, 'config.json'), AI_CLI_STATE_DIR: join(root, 'state') };
    const mcp = surface === 'mcp' ? new MCPTestClient(resolve('dist/bin/ai-cli-mcp.js'), env) : null;
    const cli = async (args: string[]) => JSON.parse((await exec(process.execPath, [resolve('dist/bin/ai-cli.js'), ...args], { env })).stdout);
    const tool = async (name: string, args: any) => JSON.parse((await mcp!.callTool(name, args))[0].text);
    const run = async (prompt: string, session_id?: string) => mcp
      ? tool('run', { prompt, workFolder: root, model: 'grok-test-alias', session_id })
      : cli(['run', '--cwd', root, '--model', 'grok-test-alias', '--prompt', prompt, ...(session_id ? ['--session-id', session_id] : [])]);
    const peek = async (pid: number, include = true) => mcp ? tool('peek', { pids: [pid], peek_time_sec: 5, include_tool_calls: include }) : cli(['peek', String(pid), '--time', '5', ...(include ? ['--include-tool-calls'] : [])]);
    const result = async (pid: number, verbose = false) => mcp ? tool('get_result', { pid, verbose }) : cli(['result', String(pid), ...(verbose ? ['--verbose'] : [])]);
    const wait = async (pid: number) => mcp ? tool('wait', { pids: [pid], timeout: 0 }) : cli(['wait', String(pid), '--timeout', '0']);
    const kill = async (pid: number) => mcp ? tool('kill_process', { pid }) : cli(['kill', String(pid)]);
    const pids: number[] = [];
    try {
      if (mcp) { await mcp.connect(); await mcp.sendRequest('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'grok-test', version: '1' } }); }
      const doctor = mcp ? await tool('doctor', {}) : await cli(['doctor']);
      expect(doctor.grok).toMatchObject({ available: true, resolvedPath: executable, lookup: 'env' });
      const models = mcp ? await tool('models', {}) : await cli(['models']);
      expect(models.grok).toContain('grok-4.6');
      expect(models.aliases).toContainEqual({ name: 'grok', resolvesTo: 'oc-xai/grok-4', agent: 'opencode' });
      expect((await cli(['alias', 'list'])).aliases).toEqual(models.aliases);
      if (mcp) expect((await mcp.listTools()).some((t: any) => t.name === 'run')).toBe(true);
      const unrelated = mcp ? await tool('run', { prompt: 'success', model: 'sonnet', workFolder: root })
        : await cli(['run', '--cwd', root, '--model', 'sonnet', '--prompt', 'success']);
      pids.push(unrelated.pid);
      expect(unrelated.agent).toBe('claude');
      expect((await wait(unrelated.pid))[0].status).toBe('completed');
      for (const prompt of ['- item', '-- separator', '---\ntitle: task\n---']) {
        writeFileSync(join(root, 'prompt.txt'), prompt);
        const hyphenJob = mcp
          ? await tool('run', { prompt, model: 'grok-4.6', workFolder: root, session_id: '--value' })
          : await cli(['run', '--cwd', root, '--model', 'grok-4.6', '--prompt-file', join(root, 'prompt.txt'), '--session-id=--value']);
        pids.push(hyphenJob.pid);
        expect((await wait(hyphenJob.pid))[0].status).toBe('completed');
        const args = JSON.parse(readFileSync(join(root, 'args.json'), 'utf8'));
        expect(args).toContain(`--single=${prompt}`);
        expect(args).toContain('--resume=--value');
      }
      const started = await run('success'); pids.push(started.pid);
      expect(started.agent).toBe('grok');
      expect((await result(started.pid)).status).toBe('running');
      const events = (await peek(started.pid)).processes[0].events;
      expect(events.filter((e: any) => e.kind === 'message')).toHaveLength(2);
      expect(events.filter((e: any) => e.kind === 'tool_call').map((e: any) => e.phase)).toEqual(['started', 'completed']);
      expect(JSON.stringify(events)).not.toContain('PRIVATE_');
      expect((await peek(started.pid)).processes[0].events).toEqual([]);
      const final = await wait(started.pid);
      expect(final[0]).toMatchObject({ agent: 'grok', status: 'completed', session_id: 'grok-session-test', agentOutput: { message: 'Check complete.' } });
      expect(final[0].agentOutput.tools).toBeUndefined();
      expect((await result(started.pid, true)).agentOutput.tools).toHaveLength(1);
      const resumed = await run('success', final[0].session_id); pids.push(resumed.pid);
      expect((await peek(resumed.pid, false)).processes[0].events.every((e: any) => e.kind === 'message')).toBe(true);
      await wait(resumed.pid);
      expect(JSON.parse(readFileSync(join(root, 'args.json'), 'utf8'))).toEqual(expect.arrayContaining(['--resume=grok-session-test', '--model', 'grok-4.6', '--reasoning-effort', 'xhigh']));
      for (const prompt of ['startup', 'partial']) {
        const failed = await run(prompt); pids.push(failed.pid);
        const [output] = await wait(failed.pid);
        expect(output).toMatchObject({ status: 'failed', exitCode: 1 });
        expect(output.stderr).toContain(prompt === 'startup' ? 'Session not found' : 'Turn limit reached');
        if (prompt === 'partial') expect(output.agentOutput).toMatchObject({ message: 'Starting bounded check.', is_error: true, errors: ['Reached the maximum number of turns'] });
      }
      const running = await run('kill'); pids.push(running.pid);
      const deadline = Date.now() + 5000;
      while (!existsSync(join(root, 'tool.pid')) && Date.now() < deadline) await delay(20);
      const childPid = Number(readFileSync(join(root, 'tool.pid'), 'utf8'));
      expect((await kill(running.pid)).status).toBe('terminated');
      expect(() => process.kill(childPid, 0)).toThrow();
      expect((await wait(running.pid))[0]).toMatchObject({ status: 'failed', exitCode: 143 });
      await delay(150);
      expect(await result(running.pid)).toMatchObject({ status: 'failed', exitCode: 143 });
      const list = mcp ? await tool('list_processes', {}) : await cli(['ps']);
      expect(JSON.stringify(list)).toContain('grok');
      const cleanup = mcp ? await tool('cleanup_processes', {}) : await cli(['cleanup']);
      expect(cleanup.removed).toBe(pids.length);
    } finally {
      for (const pid of pids) { try { await kill(pid); } catch {} }
      if (mcp) await mcp.disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  }, 40000);
});
