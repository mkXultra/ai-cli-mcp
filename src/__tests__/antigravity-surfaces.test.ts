import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MCPTestClient } from './utils/mcp-client.js';

const exec = promisify(execFile);
const stream = readFileSync(new URL('./fixtures/antigravity.ndjson', import.meta.url), 'utf8');

describe.skipIf(process.platform === 'win32')('Antigravity public surfaces', () => {
  it.each(['cli', 'mcp'])('%s supports peek, results, resume, errors and cancellation', async (surface) => {
    const root = mkdtempSync(join(tmpdir(), 'agy-surface-'));
    const executable = join(root, 'agy-test');
    writeFileSync(executable, `#!${process.execPath}
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
fs.writeFileSync('args.json', JSON.stringify(args));
const prompt = args.find(arg => arg.startsWith('--print='))?.slice(8);
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  if (prompt === 'startup') { console.error('authentication required'); process.exit(1); }
  await wait(650);
  if (prompt === 'kill') {
    process.on('SIGTERM', () => {});
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
    fs.writeFileSync('tool.pid', String(child.pid));
    setInterval(() => {}, 1000); return;
  }
  const lines = ${JSON.stringify(stream)}.trim().split('\\n');
  if (prompt === 'partial') lines[lines.length - 1] = JSON.stringify({event:'result',result:{conversation_id:'agy-session-test',status:'ERROR',response:'',error:'quota exhausted'}});
  for (const line of lines) {
    const bytes = Buffer.from(line + '\\n');
    // Force a UTF-8 character across stdout chunks as well as splitting JSON lines.
    const cut = Math.max(1, bytes.findIndex(byte => byte >= 0xe0) + 1);
    process.stdout.write(bytes.subarray(0, cut)); await wait(20);
    process.stdout.write(bytes.subarray(cut)); await wait(120);
  }
  if (prompt === 'partial') { console.error('quota diagnostic'); process.exit(1); }
})();
`, { mode: 0o755 });
    writeFileSync(join(root, 'config.json'), JSON.stringify({ model_aliases: { 'gemini-test': { model: 'gemini-3.8-flash-medium', reasoning_effort: 'medium' } } }));
    const env = { ...process.env, ANTIGRAVITY_CLI_NAME: executable, GEMINI_CLI_NAME: '/missing/legacy', ANTIGRAVITY_PRINT_TIMEOUT: '30m', AI_CLI_CONFIG_PATH: join(root, 'config.json'), AI_CLI_STATE_DIR: join(root, 'state') };
    const mcp = surface === 'mcp' ? new MCPTestClient(resolve('dist/bin/ai-cli-mcp.js'), env) : null;
    const cli = async (args: string[]) => JSON.parse((await exec(process.execPath, [resolve('dist/bin/ai-cli.js'), ...args], { env })).stdout);
    const tool = async (name: string, args: any) => JSON.parse((await mcp!.callTool(name, args))[0].text);
    const run = async (prompt: string, session_id?: string) => {
      writeFileSync(join(root, 'prompt.txt'), prompt);
      return mcp ? tool('run', { prompt, workFolder: root, model: 'gemini-test', session_id })
        : cli(['run', '--cwd', root, '--model', 'gemini-test', '--prompt-file', join(root, 'prompt.txt'), ...(session_id ? [`--session-id=${session_id}`] : [])]);
    };
    const peek = async (pid: number) => mcp ? tool('peek', { pids: [pid], peek_time_sec: 5, include_tool_calls: true }) : cli(['peek', String(pid), '--time', '5', '--include-tool-calls']);
    const result = async (pid: number, verbose = false) => mcp ? tool('get_result', { pid, verbose }) : cli(['result', String(pid), ...(verbose ? ['--verbose'] : [])]);
    const wait = async (pid: number) => mcp ? tool('wait', { pids: [pid], timeout: 0 }) : cli(['wait', String(pid), '--timeout', '0']);
    const kill = async (pid: number) => mcp ? tool('kill_process', { pid }) : cli(['kill', String(pid)]);
    const pids: number[] = [];
    try {
      if (mcp) await mcp.connect();
      const doctor = mcp ? await tool('doctor', {}) : await cli(['doctor']);
      expect(doctor.gemini).toMatchObject({ available: true, resolvedPath: executable, lookup: 'env' });
      const models = mcp ? await tool('models', {}) : await cli(['models']);
      expect(models.aliases).toContainEqual({ name: 'gemini-ultra', resolvesTo: 'gemini-3.8-flash-high', agent: 'gemini' });
      expect(models.gemini).toContain('gemini-3.8-flash-medium');
      const started = await run('--literal prompt\n日本語'); pids.push(started.pid);
      expect(started.agent).toBe('gemini');
      expect((await result(started.pid)).status).toBe('running');
      const events = (await peek(started.pid)).processes[0].events;
      expect(events.filter((e: any) => e.kind === 'message').map((e: any) => e.text)).toEqual(['確認します。', '確認完了。']);
      expect(events.filter((e: any) => e.kind === 'tool_call').map((e: any) => e.phase)).toEqual(['started', 'completed']);
      expect(JSON.stringify(events)).not.toContain('PRIVATE_');
      expect((await peek(started.pid)).processes[0].events).toEqual([]);
      const [final] = await wait(started.pid);
      expect(final).toMatchObject({ status: 'completed', session_id: 'agy-session-test', agentOutput: { message: '確認完了。', is_error: false } });
      expect(final.agentOutput.tools).toBeUndefined();
      expect((await result(started.pid, true)).agentOutput.tools).toHaveLength(1);
      expect(JSON.parse(readFileSync(join(root, 'args.json'), 'utf8'))).toEqual(expect.arrayContaining(['--print=--literal prompt\n日本語', '--print-timeout=30m', '--disable-slash-commands', '--effort', 'medium']));
      const resumed = await run('/literal skill name', final.session_id); pids.push(resumed.pid);
      await wait(resumed.pid);
      expect(JSON.parse(readFileSync(join(root, 'args.json'), 'utf8'))).toContain('--conversation=agy-session-test');
      for (const prompt of ['startup', 'partial']) {
        const failed = await run(prompt); pids.push(failed.pid);
        const [output] = await wait(failed.pid);
        expect(output).toMatchObject({ status: 'failed', exitCode: 1 });
        expect(output.stderr).toContain(prompt === 'startup' ? 'authentication required' : 'quota diagnostic');
        if (prompt === 'partial') expect(output.agentOutput).toMatchObject({ message: '確認完了。', is_error: true, error: 'quota exhausted' });
      }
      const running = await run('kill'); pids.push(running.pid);
      const deadline = Date.now() + 5000;
      while (!existsSync(join(root, 'tool.pid')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      const childPid = Number(readFileSync(join(root, 'tool.pid'), 'utf8'));
      expect((await kill(running.pid)).status).toBe('terminated');
      expect(() => process.kill(childPid, 0)).toThrow();
      expect((await wait(running.pid))[0].status).toBe('failed');
      const cleanup = mcp ? await tool('cleanup_processes', {}) : await cli(['cleanup']);
      expect(cleanup.removed).toBe(pids.length);
    } finally {
      for (const pid of pids) { try { await kill(pid); } catch {} }
      if (mcp) await mcp.disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);
});
