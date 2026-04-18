import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { prepare, syncServerJson } = require(
  resolve(process.cwd(), '.github/semantic-release-sync-server-json.cjs')
);

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('semantic-release server.json sync', () => {
  it('updates the registry manifest and all package entries to the release version', () => {
    const dir = makeTempDir('ai-cli-release-sync-');
    const serverJsonPath = join(dir, 'server.json');
    writeFileSync(
      serverJsonPath,
      JSON.stringify(
        {
          name: 'io.github.mkXultra/ai-cli-mcp',
          version: '1.0.0',
          packages: [
            {
              registryType: 'npm',
              identifier: 'ai-cli-mcp',
              version: '1.0.0',
            },
          ],
        },
        null,
        2
      )
    );

    syncServerJson(serverJsonPath, '1.2.3');

    const serverJson = readJson(serverJsonPath);
    expect(serverJson.version).toBe('1.2.3');
    expect(serverJson.packages[0].version).toBe('1.2.3');
  });

  it('wires the semantic-release prepare hook to server.json in the release cwd', async () => {
    const dir = makeTempDir('ai-cli-release-prepare-');
    writeFileSync(
      join(dir, 'server.json'),
      JSON.stringify(
        {
          version: '1.0.0',
          packages: [{ identifier: 'ai-cli-mcp', version: '1.0.0' }],
        },
        null,
        2
      )
    );

    await prepare({}, { cwd: dir, nextRelease: { version: '2.0.0' } });

    const serverJson = readJson(join(dir, 'server.json'));
    expect(serverJson.version).toBe('2.0.0');
    expect(serverJson.packages[0].version).toBe('2.0.0');
  });

  it('loads from semantic-release config before the npm plugin', () => {
    const releaseConfig = JSON.parse(readFileSync('.releaserc.json', 'utf8'));
    const pluginNames = releaseConfig.plugins.map((plugin: string | [string, unknown]) =>
      Array.isArray(plugin) ? plugin[0] : plugin
    );

    expect(pluginNames.indexOf('./.github/semantic-release-sync-server-json.cjs')).toBeGreaterThan(
      pluginNames.indexOf('@semantic-release/changelog')
    );
    expect(pluginNames.indexOf('./.github/semantic-release-sync-server-json.cjs')).toBeLessThan(
      pluginNames.indexOf('@semantic-release/npm')
    );
  });

  it('commits server.json in release commits', () => {
    const releaseConfig = JSON.parse(readFileSync('.releaserc.json', 'utf8'));
    const gitPlugin = releaseConfig.plugins.find(
      (plugin: string | [string, { assets?: string[] }]) =>
        Array.isArray(plugin) && plugin[0] === '@semantic-release/git'
    );

    expect(gitPlugin?.[1].assets).toContain('server.json');
  });
});
