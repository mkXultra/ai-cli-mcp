import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { spawnCli } from '../spawn-cli.js';
import { terminateProcessTree } from '../process-termination.js';
import { ProcessService } from '../process-service.js';

vi.mock('../spawn-cli.js', () => ({ spawnCli: vi.fn() }));
vi.mock('../process-termination.js', () => ({ terminateProcessTree: vi.fn() }));

describe('Grok cancellation finalization', () => {
  it.each(['before', 'after'])('preserves cancellation metadata when close arrives %s the tree check', async (order) => {
    const child = Object.assign(new EventEmitter(), { pid: 123456, stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null });
    vi.mocked(spawnCli).mockReturnValue(child as any);
    vi.mocked(terminateProcessTree).mockImplementation(async (_pid, options) => {
      options?.onSignalSent?.();
      if (order === 'before') child.emit('close', null, 'SIGTERM');
      return { terminated: true };
    });
    const paths = { grok: 'grok', claude: 'claude', codex: 'codex', gemini: 'gemini', forge: 'forge', opencode: 'opencode' };
    const service = new ProcessService({ cliPaths: paths });
    const { pid } = service.startProcess({ model: 'grok-4.6', workFolder: process.cwd(), prompt: 'test' });
    const pending = service.waitForProcesses([pid], 0);
    expect((await service.killProcess(pid)).status).toBe('terminated');
    expect(service.getProcessResult(pid)).toMatchObject({ status: 'failed', exitCode: 143 });
    if (order === 'after') child.emit('close', null, 'SIGTERM');
    expect((await pending)[0]).toMatchObject({ status: 'failed', exitCode: 143 });
    expect(service.getProcessResult(pid)).toMatchObject({ status: 'failed', exitCode: 143 });
  });

  it('shares pending tree cancellation with overlapping kills and shutdown, retaining cleanup metadata', async () => {
    const child = Object.assign(new EventEmitter(), { pid: 123456, stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null });
    vi.mocked(spawnCli).mockReturnValue(child as any);
    let finishTree!: () => void;
    const treePending = new Promise<void>((resolve) => { finishTree = resolve; });
    vi.mocked(terminateProcessTree).mockImplementation(async (_pid, options) => {
      options?.onSignalSent?.();
      child.emit('close', null, 'SIGTERM');
      await treePending;
      return { terminated: true };
    });
    const paths = { grok: 'grok', claude: 'claude', codex: 'codex', gemini: 'gemini', forge: 'forge', opencode: 'opencode' };
    const service = new ProcessService({ cliPaths: paths });
    const { pid } = service.startProcess({ model: 'grok-4.6', workFolder: process.cwd(), prompt: 'test' });
    const waiting = service.waitForProcesses([pid], 0);
    const first = service.killProcess(pid);
    expect((await waiting)[0]).toMatchObject({ status: 'failed', exitCode: 143 });
    expect(service.cleanupProcesses().removedPids).toEqual([]);

    let secondFinished = false;
    const second = service.killProcess(pid).then((result) => { secondFinished = true; return result; });
    let shutdownFinished = false;
    const shutdown = service.shutdown().then(() => { shutdownFinished = true; });
    await new Promise((resolve) => setImmediate(resolve));
    expect(secondFinished).toBe(false);
    expect(shutdownFinished).toBe(false);
    expect(terminateProcessTree).toHaveBeenCalledTimes(1);
    expect(() => service.startProcess({ model: 'grok', workFolder: process.cwd(), prompt: 'test' })).toThrow('shutting down');

    finishTree();
    expect(await first).toMatchObject({ status: 'terminated' });
    expect(await second).toEqual(await first);
    await shutdown;
    expect(service.getProcessResult(pid)).toMatchObject({ status: 'failed', exitCode: 143 });
    expect(service.cleanupProcesses().removedPids).toEqual([pid]);
  });

  it('preserves natural success if the root disappears before any signal is delivered', async () => {
    const child = Object.assign(new EventEmitter(), { pid: 123456, stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null });
    vi.mocked(spawnCli).mockReturnValue(child as any);
    vi.mocked(terminateProcessTree).mockImplementation(async () => {
      child.emit('close', 0);
      return { terminated: true };
    });
    const paths = { grok: 'grok', claude: 'claude', codex: 'codex', gemini: 'gemini', forge: 'forge', opencode: 'opencode' };
    const service = new ProcessService({ cliPaths: paths });
    const { pid } = service.startProcess({ model: 'grok', workFolder: process.cwd(), prompt: 'test' });
    const waiting = service.waitForProcesses([pid], 0);
    await service.killProcess(pid);
    expect((await waiting)[0]).toMatchObject({ status: 'completed', exitCode: 0 });
    expect(service.getProcessResult(pid)).toMatchObject({ status: 'completed', exitCode: 0 });
  });
});
