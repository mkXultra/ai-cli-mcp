import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { terminateProcessTree } from '../process-termination.js';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
const ps = vi.mocked(spawnSync);
const originalPlatform = process.platform;
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  Object.defineProperty(process, 'platform', { value: originalPlatform });
});

describe('Grok process tree termination', () => {
  it('finds detached descendants in an unordered process table and escalates a resistant tool', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    vi.useFakeTimers();
    let forceSent = false;
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === 300 && signal === 'SIGKILL') forceSent = true;
      return true;
    });
    ps.mockImplementation(() => ({ status: 0, stdout: forceSent ? '300 1 Z\n999 1 S' : '300 200 S\n999 1 S\n200 100 S\n100 1 S' }) as any);
    const onSignalSent = vi.fn();
    const result = terminateProcessTree(100, { ownedProcessGroup: true, onSignalSent });
    expect(onSignalSent).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ terminated: true });
    expect(kill).toHaveBeenCalledWith(-100, 'SIGTERM');
    expect(kill).toHaveBeenCalledWith(200, 'SIGTERM');
    expect(kill).toHaveBeenCalledWith(300, 'SIGTERM');
    expect(kill).toHaveBeenCalledWith(300, 'SIGKILL');
    expect(kill.mock.calls.some(([pid]) => pid === 999)).toBe(false);
    expect(onSignalSent).toHaveBeenCalledTimes(1);
  });

  it('falls back without ps, escalates the owned group and reports the limitation', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    vi.useFakeTimers();
    ps.mockReturnValue({ status: 1, stdout: '' } as any);
    let forced = false;
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal === 'SIGKILL') forced = true;
      if (signal === 0 && forced) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      return true;
    });
    const pending = terminateProcessTree(100, { ownedProcessGroup: true });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ terminated: true, warning: expect.stringContaining('Descendants in other process groups may survive') });
    expect(kill).toHaveBeenCalledWith(-100, 'SIGTERM');
    expect(kill).toHaveBeenCalledWith(-100, 'SIGKILL');
    expect(kill).toHaveBeenCalledWith(100, 0);
  });

  it('never signals an unowned group or claims termination when signaling fails', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    ps.mockReturnValue({ status: 1, stdout: '' } as any);
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); });
    const onSignalSent = vi.fn();
    await expect(terminateProcessTree(100, { onSignalSent })).rejects.toThrow('denied');
    expect(onSignalSent).not.toHaveBeenCalled();
    expect(kill).toHaveBeenCalledWith(100, 'SIGTERM');
    expect(kill.mock.calls.some(([pid]) => pid < 0)).toBe(false);
    await expect(terminateProcessTree(process.pid)).rejects.toThrow('host PID');
  });

  it('does not mark cancellation when every signal finds the process already gone', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    ps.mockReturnValue({ status: 0, stdout: '' } as any);
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); });
    const onSignalSent = vi.fn();
    expect(await terminateProcessTree(100, { ownedProcessGroup: true, onSignalSent })).toEqual({ terminated: true });
    expect(onSignalSent).not.toHaveBeenCalled();
  });

  it('uses Windows tree termination and surfaces taskkill failures', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    ps.mockReturnValue({ status: 0 } as any);
    const onSignalSent = vi.fn();
    expect(await terminateProcessTree(100, { onSignalSent })).toEqual({ terminated: true });
    expect(onSignalSent).toHaveBeenCalledTimes(1);
    expect(ps).toHaveBeenCalledWith('taskkill.exe', ['/pid', '100', '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    ps.mockReturnValue({ status: 1 } as any);
    onSignalSent.mockClear();
    await expect(terminateProcessTree(100, { onSignalSent })).rejects.toThrow('Failed to terminate');
    expect(onSignalSent).not.toHaveBeenCalled();
  });
});
