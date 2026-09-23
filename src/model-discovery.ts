import { stripVTControlCharacters } from 'node:util';
import { findOpencodeCli, findPiCli } from './cli-utils.js';
import { getModelsPayload } from './model-catalog.js';
import { spawnCli } from './spawn-cli.js';

type Backend = 'pi' | 'opencode';
interface DiscoveryResult {
  models: string[];
  status: 'success' | 'error';
  checkedAt: string;
  error?: string;
}

const commands = { pi: ['--list-models'], opencode: ['models'] };
const providerPattern = /^[A-Za-z0-9_.-]+$/;

export function parseDiscoveredModels(backend: Backend, output: string): string[] {
  const lines = stripVTControlCharacters(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const models = new Set<string>();
  if (backend === 'pi') {
    const header = lines.findIndex((line) => /^provider\s+model\s+context\s+max-out\s+thinking\s+images$/.test(line));
    if (header < 0) {
      if (lines.some((line) => /^No models available\b/.test(line))) return [];
      throw new Error('Unrecognized Pi model list format.');
    }
    for (const line of lines.slice(header + 1)) {
      const fields = line.split(/\s+/);
      if (fields.length !== 6 || !providerPattern.test(fields[0]) || !/^(yes|no)$/.test(fields[4]) || !/^(yes|no)$/.test(fields[5])) continue;
      models.add(`pi-${fields[0]}/${fields[1]}`);
    }
    if (lines.length > header + 1 && models.size === 0) throw new Error('Unrecognized Pi model rows.');
  } else {
    for (const line of lines) {
      if (/^[A-Za-z0-9_.-]+\/[^\s]+$/.test(line)) models.add(`oc-${line}`);
    }
    if (lines.length && models.size === 0) throw new Error('Unrecognized OpenCode model list format.');
  }
  return [...models];
}

// Shared by the two public surfaces. Cache is process-local: an MCP server reuses
// it, while each standalone CLI invocation discovers current configuration.
export class ModelDiscovery {
  private readonly cache = new Map<string, { expiresAt: number; result: Promise<DiscoveryResult> }>();

  constructor(private readonly options: { timeoutMs?: number; cacheTtlMs?: number; maxOutputBytes?: number } = {}) {}

  async discover(backend: Backend, command: string, cwd = process.cwd()) {
    // Configuration and PATH changes must not reuse a different environment's list.
    const key = JSON.stringify([backend, command, cwd, process.env]);
    const existing = this.cache.get(key);
    if (existing && existing.expiresAt > Date.now()) return { ...await existing.result, cached: true };

    const entry = { expiresAt: Infinity, result: this.execute(backend, command, cwd) };
    this.cache.set(key, entry);
    if (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!);
    const result = await entry.result;
    entry.expiresAt = Date.now() + (this.options.cacheTtlMs ?? 60_000);
    return { ...result, cached: false };
  }

  private async execute(backend: Backend, command: string, cwd: string): Promise<DiscoveryResult> {
    try {
      const output = await this.readOutput(command, commands[backend], cwd);
      return { models: parseDiscoveredModels(backend, output), status: 'success', checkedAt: new Date().toISOString() };
    } catch (error) {
      return {
        models: [], status: 'error', checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private readOutput(command: string, args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawnCli(command, args, {
        cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      });
      let stdout = '';
      let bytes = 0;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          try { child.kill('SIGKILL'); } catch { /* still report the discovery failure */ }
          child.stdout?.destroy();
          child.stderr?.destroy();
          child.unref();
          reject(error);
        } else resolve(stdout);
      };
      const timer = setTimeout(() => finish(new Error(`Model discovery timed out after ${this.options.timeoutMs ?? 5000} ms.`)), this.options.timeoutMs ?? 5000);
      const collect = (chunk: string, isStdout: boolean) => {
        if (settled) return;
        bytes += Buffer.byteLength(chunk);
        if (bytes > (this.options.maxOutputBytes ?? 1024 * 1024)) {
          finish(new Error('Model discovery output exceeded the size limit.'));
        } else if (isStdout) stdout += chunk;
      };
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => collect(chunk, true));
      child.stderr?.on('data', (chunk: string) => collect(chunk, false));
      child.once('error', (error) => finish(error));
      child.once('close', (code, signal) => finish(code === 0 ? undefined : new Error(`Model discovery exited with ${signal || `code ${code}`}.`)));
    });
  }
}

const discovery = new ModelDiscovery();

export async function getDiscoveredModelsPayload() {
  const payload = getModelsPayload();
  const results = await Promise.all((['pi', 'opencode'] as const).map(async (backend) => {
    try {
      return await discovery.discover(backend, backend === 'pi' ? findPiCli() : findOpencodeCli());
    } catch (error) {
      return { models: [], status: 'error' as const, cached: false, checkedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) };
    }
  }));
  for (const [index, backend] of (['pi', 'opencode'] as const).entries()) {
    const { models, ...status } = results[index];
    payload[backend] = [...payload[backend], ...models];
    payload.dynamicModelBackends[backend].discovery = status;
  }
  return payload;
}
