import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestClient, MCPTestClient } from './utils/mcp-client.js';
import { getSharedMock } from './utils/persistent-mock.js';

const packageVersion = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')
).version;

describe('Version Print on First Use', () => {
  let client: MCPTestClient;
  let testDir: string;
  let consoleErrorSpy: any;

  beforeEach(async () => {
    // Ensure mock exists
    await getSharedMock();

    // Create a temporary directory for test files
    testDir = mkdtempSync(join(tmpdir(), 'claude-code-test-'));

    // Spy on console.error
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    client = createTestClient({ debug: false });
    await client.connect();
  });

  afterEach(async () => {
    // Disconnect client
    await client.disconnect();
    
    // Clean up test directory
    rmSync(testDir, { recursive: true, force: true });
    
    // Restore console.error spy
    consoleErrorSpy.mockRestore();
  });

  it('should print version and startup time only on first use', async () => {
    // First tool call
    await client.callTool('run', {
      prompt: 'echo "test 1"',
      workFolder: testDir,
    });
    
    // Find the version print in the console.error calls
    const findVersionCall = (calls: any[][]) => {
      return calls.find(call => {
        const str = call[1] || call[0]; // message might be first or second param
        return typeof str === 'string' && str.includes('ai_cli_mcp v') && str.includes('started at');
      });
    };
    
    // Check that version was printed on first use
    const versionCall = findVersionCall(consoleErrorSpy.mock.calls);
    expect(versionCall).toBeDefined();
    expect(versionCall![1]).toContain(`ai_cli_mcp v${packageVersion}`);
    expect(versionCall![1]).toMatch(/ai_cli_mcp v[0-9]+\.[0-9]+\.[0-9]+ started at \d{4}-\d{2}-\d{2}T/);
    
    // Clear the spy but keep the spy active
    consoleErrorSpy.mockClear();
    
    // Second tool call
    await client.callTool('run', {
      prompt: 'echo "test 2"',
      workFolder: testDir,
    });
    
    // Check that version was NOT printed on second use
    const secondVersionCall = findVersionCall(consoleErrorSpy.mock.calls);
    expect(secondVersionCall).toBeUndefined();
    
    // Third tool call
    await client.callTool('run', {
      prompt: 'echo "test 3"',
      workFolder: testDir,
    });
    
    // Should still not have been called with version print
    const thirdVersionCall = findVersionCall(consoleErrorSpy.mock.calls);
    expect(thirdVersionCall).toBeUndefined();
  });
});
