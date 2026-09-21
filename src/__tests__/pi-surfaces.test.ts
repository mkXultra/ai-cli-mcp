import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MCPTestClient } from './utils/mcp-client.js';

const exec = promisify(execFile);
const stream = readFileSync(new URL('./fixtures/pi.ndjson', import.meta.url), 'utf8');
const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

describe.skipIf(process.platform === 'win32')('Pi public surfaces', () => {
  it.each(['cli', 'mcp'])('%s supports results, peek, resume, errors, and cancellation', async (surface) => {
    const root = mkdtempSync(join(tmpdir(), 'pi-surface-'));
    const executable = join(root, 'pi-test');
    writeFileSync(executable, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync('args.json', JSON.stringify(args));
const separator = args.indexOf('--');
const prompt = separator >= 0 ? args[separator + 1] : '';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  if (prompt === 'startup') { console.error('Pi authentication required'); process.exit(1); }
  await wait(650);
  if (prompt === 'kill') {
    fs.writeFileSync('ready', 'ready');
    setInterval(() => {}, 1000); return;
  }
  for (const line of ${JSON.stringify(stream)}.trim().split('\\n')) {
    const cut = Math.max(1, Math.floor(line.length / 2));
    process.stdout.write(line.slice(0, cut)); await wait(15);
    process.stdout.write(line.slice(cut) + '\\n'); await wait(100);
  }
})();
`, { mode: 0o755 });
    writeFileSync(join(root, 'config.json'), JSON.stringify({
      model_aliases: { 'pi-test-alias': { model: 'pi-openai-codex/gpt-6-astra', reasoning_effort: 'max' } },
    }));
    const env = {
      ...process.env,
      PI_CLI_NAME: executable,
      AI_CLI_CONFIG_PATH: join(root, 'config.json'),
      AI_CLI_STATE_DIR: join(root, 'state'),
    };
    const mcp = surface === 'mcp' ? new MCPTestClient(resolve('dist/bin/ai-cli-mcp.js'), env) : null;
    const cli = async (args: string[]) => JSON.parse((await exec(process.execPath, [resolve('dist/bin/ai-cli.js'), ...args], { env })).stdout);
    const tool = async (name: string, args: any) => JSON.parse((await mcp!.callTool(name, args))[0].text);
    const run = async (prompt: string, sessionId?: string) => mcp
      ? tool('run', { prompt, workFolder: root, model: 'pi-test-alias', session_id: sessionId })
      : cli(['run', '--cwd', root, '--model', 'pi-test-alias', `--prompt=${prompt}`, ...(sessionId ? [`--session-id=${sessionId}`] : [])]);
    const wait = async (pid: number) => mcp ? tool('wait', { pids: [pid], timeout: 0 }) : cli(['wait', String(pid), '--timeout', '0']);
    const peek = async (pid: number) => mcp
      ? tool('peek', { pids: [pid], peek_time_sec: 5, include_tool_calls: true })
      : cli(['peek', String(pid), '--time', '5', '--include-tool-calls']);
    const result = async (pid: number, verbose = false) => mcp
      ? tool('get_result', { pid, verbose })
      : cli(['result', String(pid), ...(verbose ? ['--verbose'] : [])]);
    const kill = async (pid: number) => mcp ? tool('kill_process', { pid }) : cli(['kill', String(pid)]);
    const pids: number[] = [];

    try {
      if (mcp) await mcp.connect();
      const doctor = mcp ? await tool('doctor', {}) : await cli(['doctor']);
      expect(doctor.pi).toMatchObject({ available: true, resolvedPath: executable, lookup: 'env' });
      const models = mcp ? await tool('models', {}) : await cli(['models']);
      expect(models.pi).toEqual(['pi']);
      expect(models.dynamicModelBackends.pi.discoveryCommand).toBe('pi --list-models');

      const started = await run('--literal Pi prompt');
      pids.push(started.pid);
      expect(started.agent).toBe('pi');
      const events = (await peek(started.pid)).processes[0].events;
      expect(events.filter((event: any) => event.kind === 'message').map((event: any) => event.text)).toEqual(['Pi done.']);
      expect(events.filter((event: any) => event.kind === 'tool_call').map((event: any) => event.phase)).toEqual(['started', 'completed']);
      expect(JSON.stringify(events)).not.toContain('PRIVATE_');
      const [final] = await wait(started.pid);
      expect(final).toMatchObject({ agent: 'pi', status: 'completed', session_id: 'pi-session-test', agentOutput: { message: 'Pi done.', model: 'gpt-6-astra' } });
      expect(final.agentOutput.tools).toBeUndefined();
      expect((await result(started.pid, true)).agentOutput.tools).toHaveLength(1);
      expect(JSON.parse(readFileSync(join(root, 'args.json'), 'utf8'))).toEqual(expect.arrayContaining([
        '--mode', 'json', '--approve', '--model', 'openai-codex/gpt-6-astra', '--thinking', 'max', '-p', '--', '--literal Pi prompt',
      ]));

      const resumed = await run('resume', final.session_id);
      pids.push(resumed.pid);
      await wait(resumed.pid);
      expect(JSON.parse(readFileSync(join(root, 'args.json'), 'utf8'))).toEqual(expect.arrayContaining(['--session', 'pi-session-test']));

      const failed = await run('startup');
      pids.push(failed.pid);
      const [failure] = await wait(failed.pid);
      expect(failure).toMatchObject({ agent: 'pi', status: 'failed', exitCode: 1 });
      expect(failure.stderr).toContain('Pi authentication required');

      if (surface === 'cli') {
        const running = await run('kill');
        pids.push(running.pid);
        const deadline = Date.now() + 5000;
        while (!existsSync(join(root, 'ready')) && Date.now() < deadline) await delay(20);
        expect((await kill(running.pid)).status).toBe('terminated');
        expect((await wait(running.pid))[0]).toMatchObject({ status: 'failed', exitCode: 143 });
      }
    } finally {
      for (const pid of pids) {
        try { await kill(pid); } catch {}
      }
      if (mcp) await mcp.disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);
});
