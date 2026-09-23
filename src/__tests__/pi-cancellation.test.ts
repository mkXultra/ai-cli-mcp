import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { spawnCli } from '../spawn-cli.js';
import { terminateProcessTree } from '../process-termination.js';
import { ProcessService } from '../process-service.js';

vi.mock('../spawn-cli.js', () => ({ spawnCli: vi.fn() }));
vi.mock('../process-termination.js', () => ({ terminateProcessTree: vi.fn() }));

describe('Pi cancellation', () => {
  it('uses detached process-tree termination and records cancellation metadata', async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 123456,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      signalCode: null,
    });
    vi.mocked(spawnCli).mockReturnValue(child as any);
    vi.mocked(terminateProcessTree).mockImplementation(async (_pid, options) => {
      options?.onSignalSent?.();
      child.emit('close', null, 'SIGTERM');
      return { terminated: true };
    });
    const paths = { pi: 'pi', grok: 'grok', claude: 'claude', codex: 'codex', gemini: 'agy', opencode: 'opencode' };
    const service = new ProcessService({ cliPaths: paths });
    const { pid } = service.startProcess({ model: 'pi', workFolder: process.cwd(), prompt: 'test' });

    expect(spawnCli).toHaveBeenCalledWith('pi', expect.any(Array), expect.objectContaining({ detached: process.platform !== 'win32' }));
    expect((await service.killProcess(pid)).status).toBe('terminated');
    expect(terminateProcessTree).toHaveBeenCalledWith(pid, expect.objectContaining({ ownedProcessGroup: process.platform !== 'win32' }));
    expect(service.getProcessResult(pid)).toMatchObject({ agent: 'pi', status: 'failed', exitCode: 143 });
  });
});
