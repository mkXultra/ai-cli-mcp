import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ProcessService } from '../process-service.js';
import { CliProcessService } from '../cli-process-service.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check() && Date.now() < deadline) await delay(20);
  expect(check()).toBe(true);
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
function fixture(root: string, detached: boolean) {
  const file = join(root, 'grok-test');
  const tool = `const fs=require('node:fs');
process.on('SIGTERM',()=>{});
fs.writeFileSync('tool-ticks','tick\\n');
fs.writeFileSync('tool.pid',String(process.pid));
setInterval(()=>fs.appendFileSync('tool-ticks','tick\\n'),50);`;
  writeFileSync(file, `#!${process.execPath}
const { spawn } = require('node:child_process');
spawn(process.execPath, ['-e', ${JSON.stringify(tool)}], { detached: ${detached}, stdio: 'ignore' });
console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'ready'}]}}));
setInterval(()=>{},1000);
`, { mode: 0o755 });
  return file;
}

describe.skipIf(process.platform === 'win32')('Grok host lifecycle and degraded cancellation', () => {
  it.each(['mcp', 'cli'])('%s still stops an owned group when ps is missing', async (surface) => {
    const root = mkdtempSync(join(tmpdir(), 'grok-no-ps-'));
    const file = fixture(root, false);
    const paths = { grok: file, claude: file, codex: file, gemini: file, opencode: file };
    const service = surface === 'mcp' ? new ProcessService({ cliPaths: paths }) : new CliProcessService({ cliPaths: paths, stateDir: join(root, 'state') });
    let pid: number | undefined;
    let toolPid: number | undefined;
    try {
      const job = await service.startProcess({ cwd: root, workFolder: root, model: 'grok-4.6', prompt: 'test' });
      pid = job.pid;
      await waitFor(() => existsSync(join(root, 'tool.pid')));
      toolPid = Number(readFileSync(join(root, 'tool.pid'), 'utf8'));
      await delay(100); // Child installs its TERM handler before cancellation.
      vi.stubEnv('PATH', join(root, 'no-programs'));
      const killed = await service.killProcess(pid);
      expect(killed.status).toBe('terminated');
      expect(killed.message).toContain('Descendants in other process groups may survive');
      await waitFor(() => !alive(toolPid!));
      const [result] = await service.waitForProcesses([pid], 0);
      expect(result).toMatchObject({ status: 'failed', exitCode: 143 });
      expect(result.stderr).toContain('Process table unavailable');
    } finally {
      vi.unstubAllEnvs();
      for (const value of [pid, toolPid]) if (value && alive(value)) { try { process.kill(value, 'SIGKILL'); } catch {} }
      rmSync(root, { recursive: true, force: true });
    }
  }, 10000);

  it.each(['SIGINT', 'SIGTERM', 'SIGHUP', 'stdin', 'SIGTERM during kill', 'stdin during kill'])('stops Grok and its detached tool when the MCP host receives %s', async (cause) => {
    const root = mkdtempSync(join(tmpdir(), 'grok-host-'));
    const file = fixture(root, true);
    writeFileSync(join(root, 'config.json'), '{}');
    const host = spawn(process.execPath, [resolve('dist/bin/ai-cli-mcp.js')], {
      cwd: root, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GROK_CLI_NAME: file, AI_CLI_CONFIG_PATH: join(root, 'config.json') },
    });
    const pending = new Map<number, (value: any) => void>();
    let seq = 0;
    let buffer = '';
    host.stdout.setEncoding('utf8');
    host.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const line of lines) { const response = JSON.parse(line); pending.get(response.id)?.(response); }
    });
    host.stderr.resume();
    const request = async (method: string, params: any) => {
      const id = ++seq;
      const response = new Promise<any>((r) => pending.set(id, r));
      host.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      return response;
    };
    let grokPid: number | undefined;
    let toolPid: number | undefined;
    try {
      await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'shutdown-test', version: '1' } });
      const response = await request('tools/call', { name: 'run', arguments: { workFolder: root, model: 'grok-4.6', prompt: 'test' } });
      grokPid = JSON.parse(response.result.content[0].text).pid;
      await waitFor(() => existsSync(join(root, 'tool.pid')));
      toolPid = Number(readFileSync(join(root, 'tool.pid'), 'utf8'));
      if (cause.endsWith('during kill')) {
        let killFinished = false;
        void request('tools/call', { name: 'kill_process', arguments: { pid: grokPid } }).then(() => { killFinished = true; });
        const deadline = Date.now() + 5000;
        let result;
        do {
          const response = await request('tools/call', { name: 'get_result', arguments: { pid: grokPid } });
          result = JSON.parse(response.result.content[0].text);
          if (result.status !== 'running') break;
          await delay(10);
        } while (Date.now() < deadline);
        expect(result).toMatchObject({ status: 'failed', exitCode: 143 });
        expect(killFinished).toBe(false);
        expect(alive(toolPid!)).toBe(true);
        let overlappingKillFinished = false;
        void request('tools/call', { name: 'kill_process', arguments: { pid: grokPid } }).then(() => { overlappingKillFinished = true; });
        const cleanup = await request('tools/call', { name: 'cleanup_processes', arguments: {} });
        expect(JSON.parse(cleanup.result.content[0].text).removedPids).toEqual([]);
        expect(overlappingKillFinished).toBe(false);
      }
      const closed = new Promise((r) => host.once('close', r));
      if (cause.startsWith('stdin')) host.stdin.end();
      else if (cause === 'SIGTERM during kill') host.kill('SIGTERM');
      else process.kill(-host.pid!, cause as NodeJS.Signals);
      await closed;
      expect(alive(grokPid!)).toBe(false);
      expect(alive(toolPid!)).toBe(false);
      const ticksAtExit = readFileSync(join(root, 'tool-ticks'), 'utf8');
      await delay(200);
      expect(readFileSync(join(root, 'tool-ticks'), 'utf8')).toBe(ticksAtExit);
      expect(host.exitCode).toBe(0);
      expect(alive(process.pid)).toBe(true);
    } finally {
      for (const pid of [grokPid, toolPid, host.pid]) { if (pid) { try { process.kill(-pid, 'SIGKILL'); } catch {} } }
      if (host.exitCode === null && host.signalCode === null) await new Promise((r) => host.once('close', r));
      rmSync(root, { recursive: true, force: true });
    }
  }, 10000);
});
