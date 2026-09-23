import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ProcessService } from '../process-service.js';
import { CliProcessService } from '../cli-process-service.js';

describe.skipIf(process.platform === 'win32')('Grok UTF-8 byte boundaries', () => {
  it.each(['mcp', 'cli'])('%s decodes split Japanese/emoji bytes in peek, final output and partial failures', async (surface) => {
    const root = mkdtempSync(join(tmpdir(), 'grok-utf8-'));
    const executable = join(root, 'grok-test');
    writeFileSync(executable, `#!${process.execPath}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function splitWrite(stream, text) {
  const buffer = Buffer.from(text);
  const cuts = [0, buffer.indexOf(Buffer.from('日')) + 1, buffer.indexOf(Buffer.from('😀')) + 2, buffer.length].filter(n => n > 0 || n === 0).sort((a,b) => a-b);
  for (let i = 1; i < cuts.length; i++) { stream.write(buffer.subarray(cuts[i-1], cuts[i])); await wait(100); }
}
(async () => {
  await wait(300);
  await splitWrite(process.stdout, JSON.stringify({type:'assistant',session_id:'utf8-session',message:{content:[{type:'text',text:'日本語 😀'}]}})+'\\n');
  if (process.argv.includes('--single=partial')) {
    await splitWrite(process.stderr, '日本語の診断 😀\\n');
    console.log(JSON.stringify({type:'result',subtype:'error_max_turns',is_error:true,errors:['turn limit'],stop_reason:'cancelled'}));
    process.exitCode = 1;
  } else {
    await splitWrite(process.stdout, JSON.stringify({type:'result',result:'完了 日本語 😀',is_error:false})+'\\n');
  }
})();
`, { mode: 0o755 });
    const cliPaths = { grok: executable, claude: executable, codex: executable, gemini: executable, opencode: executable };
    const service = surface === 'mcp' ? new ProcessService({ cliPaths }) : new CliProcessService({ cliPaths, stateDir: join(root, 'state') });
    try {
      for (const prompt of ['success', 'partial']) {
        const job = await service.startProcess({ cwd: root, workFolder: root, model: 'grok-4.6', prompt });
        const peek = await service.peekProcesses([job.pid], 5, true);
        expect(peek.processes[0].events).toEqual([{ kind: 'message', ts: expect.any(String), text: '日本語 😀' }]);
        const [result] = await service.waitForProcesses([job.pid], 0);
        expect(result.agentOutput.message).toBe(prompt === 'success' ? '完了 日本語 😀' : '日本語 😀');
        if (prompt === 'partial') {
          expect(result.stderr).toBe('日本語の診断 😀\n');
          expect(result).toMatchObject({ status: 'failed', exitCode: 1, agentOutput: { is_error: true, errors: ['turn limit'] } });
        }
      }
    } finally {
      for (const job of await service.listProcesses()) if (job.status === 'running') await service.killProcess(job.pid);
      await service.cleanupProcesses();
      rmSync(root, { recursive: true, force: true });
    }
  }, 10000);
});
