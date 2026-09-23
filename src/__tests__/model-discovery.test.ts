import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelDiscovery, getDiscoveredModelsPayload, parseDiscoveredModels } from '../model-discovery.js';
import { spawnCli } from '../spawn-cli.js';

vi.mock('../spawn-cli.js', () => ({ spawnCli: vi.fn() }));
const piTable = 'provider model context max-out thinking images\nopenai-codex gpt-6-astra 272K 128K yes yes\ncloudflare-dynamic dynamic/glm53 1.0M 131.1K yes no\n';

function child() {
  const proc = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), unref: vi.fn(),
  });
  vi.mocked(spawnCli).mockReturnValue(proc as any);
  return proc;
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('dynamic model discovery', () => {
  it('parses real CLI formats, ANSI colors, nested names and duplicates without diagnostic text', () => {
    expect(parseDiscoveredModels('pi', '\u001b[32m' + piTable + '\u001b[0m')).toEqual(['pi-openai-codex/gpt-6-astra', 'pi-cloudflare-dynamic/dynamic/glm53']);
    expect(parseDiscoveredModels('opencode', 'Warning: offline\nopenai/gpt-6-astra\nopenai/gpt-6-astra\nlocal/qwen:32b\ncustom/nested/model\n')).toEqual(['oc-openai/gpt-6-astra', 'oc-local/qwen:32b', 'oc-custom/nested/model']);
    expect(parseDiscoveredModels('pi', 'No models available. Use /login to log in.')).toEqual([]);
    expect(parseDiscoveredModels('opencode', '')).toEqual([]);
    expect(() => parseDiscoveredModels('pi', 'unexpected new format')).toThrow('format');
    expect(() => parseDiscoveredModels('opencode', '{"type":"error"}')).toThrow('format');
  });

  it('coalesces concurrent calls, caches for 60 seconds and refreshes after expiry', async () => {
    vi.useFakeTimers();
    const proc = child();
    const discovery = new ModelDiscovery();
    const first = discovery.discover('pi', '/custom/pi');
    const second = discovery.discover('pi', '/custom/pi');
    proc.stdout.write(piTable); proc.emit('close', 0);
    expect(await first).toMatchObject({ status: 'success', cached: false, models: ['pi-openai-codex/gpt-6-astra', 'pi-cloudflare-dynamic/dynamic/glm53'] });
    expect(await second).toMatchObject({ status: 'success', cached: true });
    expect(await discovery.discover('pi', '/custom/pi')).toMatchObject({ cached: true });
    expect(spawnCli).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_001);
    const next = child();
    const refresh = discovery.discover('pi', '/custom/pi');
    next.stdout.write(piTable.replace('gpt-6-astra', 'new-model')); next.emit('close', 0);
    expect((await refresh).models).toContain('pi-openai-codex/new-model');
    expect(spawnCli).toHaveBeenCalledTimes(2);
    expect(spawnCli).toHaveBeenLastCalledWith('/custom/pi', ['--list-models'], expect.objectContaining({ cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] }));
  });

  it('does not share cached models across commands, directories, or environments', async () => {
    const discovery = new ModelDiscovery();
    for (const [command, cwd, config] of [['pi-one', '/first', 'a'], ['pi-two', '/first', 'a'], ['pi-two', '/second', 'a'], ['pi-two', '/second', 'b']]) {
      vi.stubEnv('PI_CODING_AGENT_DIR', config);
      const proc = child();
      const pending = discovery.discover('pi', command, cwd);
      proc.stdout.write(piTable); proc.emit('close', 0);
      expect((await pending).cached).toBe(false);
    }
    expect(spawnCli).toHaveBeenCalledTimes(4);
  });

  it('kills a hanging CLI at the deadline and resolves even without a close event', async () => {
    vi.useFakeTimers();
    const proc = child();
    const pending = new ModelDiscovery({ timeoutMs: 100 }).discover('pi', 'pi');
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ status: 'error', models: [], error: 'Model discovery timed out after 100 ms.' });
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it.each(['stdout', 'stderr'] as const)('limits %s output', async (source) => {
    const proc = child();
    const pending = new ModelDiscovery({ maxOutputBytes: 8 }).discover('pi', 'pi');
    proc[source].write('0123456789');
    expect(await pending).toMatchObject({ status: 'error', error: 'Model discovery output exceeded the size limit.' });
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('reports missing binaries and nonzero exits instead of accepting partial models', async () => {
    let proc = child();
    const missing = new ModelDiscovery().discover('pi', 'missing');
    proc.emit('error', new Error('spawn missing ENOENT'));
    expect(await missing).toMatchObject({ status: 'error', error: 'spawn missing ENOENT' });
    proc = child();
    const failed = new ModelDiscovery().discover('pi', 'pi');
    proc.stdout.write(piTable); proc.emit('close', 1);
    expect(await failed).toMatchObject({ status: 'error', models: [], error: 'Model discovery exited with code 1.' });
  });

  it('isolates one backend failure and keeps aliases and the other discovered models', async () => {
    vi.stubEnv('PI_CLI_NAME', './invalid-pi');
    vi.stubEnv('OPENCODE_CLI_NAME', '/test/opencode');
    const proc = child();
    const pending = getDiscoveredModelsPayload();
    proc.stdout.write('openai/gpt-6-astra\n'); proc.emit('close', 0);
    const result = await pending;
    expect(result.pi).toEqual(['pi']);
    expect(result.opencode).toEqual(['opencode', 'oc-openai/gpt-6-astra']);
    expect(result.aliases.length).toBeGreaterThan(0);
    expect(result.dynamicModelBackends.pi.discovery).toMatchObject({ status: 'error', error: expect.stringContaining('Invalid PI_CLI_NAME') });
    expect(result.dynamicModelBackends.opencode.discovery).toMatchObject({ status: 'success' });
  });
});
