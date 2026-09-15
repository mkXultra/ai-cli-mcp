import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ProcessService } from '../process-service.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(process.platform === 'win32')('Grok service signal failures with a real child', () => {
  it.each([false, true])('keeps cancellation metadata only if a signal was delivered (delivered: %s)', async (delivered) => {
    const root = mkdtempSync(join(tmpdir(), 'grok-signal-error-'));
    const file = join(root, 'grok-test');
    writeFileSync(file, `#!${process.execPath}
const fs = require('node:fs');
process.on('SIGTERM', () => {});
fs.writeFileSync('ready', 'ready');
setInterval(() => {
  if (fs.existsSync('finish')) {
    console.log(JSON.stringify({type:'result',is_error:false,subtype:'success',result:'completed normally'}));
    process.exit(0);
  }
}, 20);
`, { mode: 0o755 });
    const paths = { grok: file, claude: file, codex: file, gemini: file, forge: file, opencode: file };
    const service = new ProcessService({ cliPaths: paths });
    const { pid } = service.startProcess({ model: 'grok-4.6', workFolder: root, prompt: 'test' });
    const realKill = process.kill.bind(process);
    let killSpy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const deadline = Date.now() + 5000;
      while (!existsSync(join(root, 'ready')) && Date.now() < deadline) await delay(10);
      expect(existsSync(join(root, 'ready'))).toBe(true);
      const waiting = service.waitForProcesses([pid], 5);
      let attempts = 0;
      let sent = 0;
      killSpy = vi.spyOn(process, 'kill').mockImplementation((target, signal) => {
        if ((target === pid || target === -pid) && signal === 'SIGTERM') {
          attempts++;
          if (!delivered || attempts > 1) throw Object.assign(new Error('permission denied'), { code: 'EPERM' });
          const result = realKill(target, signal);
          sent++;
          return result;
        }
        return realKill(target, signal);
      });
      await expect(service.killProcess(pid)).rejects.toThrow('permission denied');
      expect(attempts).toBe(delivered ? 2 : 1);
      expect(sent).toBe(delivered ? 1 : 0);
      killSpy.mockRestore();
      writeFileSync(join(root, 'finish'), 'finish');

      const [result] = await waiting;
      expect(result).toMatchObject({
        status: delivered ? 'failed' : 'completed',
        exitCode: delivered ? 143 : 0,
        agentOutput: { is_error: false, subtype: 'success', message: 'completed normally' },
      });
      expect(service.getProcessResult(pid)).toEqual(result);
      expect(service.cleanupProcesses().removedPids).toEqual([pid]);
    } finally {
      killSpy?.mockRestore();
      try { realKill(-pid, 'SIGKILL'); } catch {}
      await service.waitForProcesses([pid], 2).catch(() => {});
      rmSync(root, { recursive: true, force: true });
    }
  }, 10000);
});
