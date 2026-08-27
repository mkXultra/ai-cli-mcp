import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestClient, MCPTestClient } from './utils/mcp-client.js';
import { getSharedMock, cleanupSharedMock } from './utils/persistent-mock.js';

describe('Claude Code Edge Cases', () => {
  let client: MCPTestClient;
  let testDir: string;

  beforeEach(async () => {
    // Ensure mock exists
    await getSharedMock();

    // Create test directory
    testDir = mkdtempSync(join(tmpdir(), 'claude-code-edge-'));

    client = createTestClient();
    await client.connect();
  });

  afterEach(async () => {
    await client.disconnect();
    rmSync(testDir, { recursive: true, force: true });
  });
  
  afterAll(async () => {
    // Cleanup mock only at the end
    await cleanupSharedMock();
  });

  describe('Input Validation', () => {
    it('should reject missing prompt', async () => {
      await expect(
        client.callTool('run', {
          workFolder: testDir,
        })
      ).rejects.toThrow(/prompt/i);
    });

    it('should reject invalid prompt type', async () => {
      await expect(
        client.callTool('run', {
          prompt: 123, // Should be string
          workFolder: testDir,
        })
      ).rejects.toThrow();
    });

    it('should reject invalid workFolder type', async () => {
      await expect(
        client.callTool('run', {
          prompt: 'Test prompt',
          workFolder: 123, // Should be string
        })
      ).rejects.toThrow(/workFolder/i);
    });

    it('should reject empty prompt', async () => {
      await expect(
        client.callTool('run', {
          prompt: '',
          workFolder: testDir,
        })
      ).rejects.toThrow(/prompt/i);
    });
  });

  describe('Special Characters', () => {
    it.skip('should handle prompts with quotes', async () => {
      // Skipping: This test fails in CI when mock is not found at expected path
      const response = await client.callTool('run', {
        prompt: 'Create a file with content "Hello \\"World\\""',
        workFolder: testDir,
      });

      expect(response).toBeTruthy();
    });

    it('should handle prompts with newlines', async () => {
      const response = await client.callTool('run', {
        prompt: 'Create a file with content:\\nLine 1\\nLine 2',
        workFolder: testDir,
      });

      expect(response).toBeTruthy();
    });

    it('should handle prompts with shell special characters', async () => {
      const response = await client.callTool('run', {
        prompt: 'Create a file named test$file.txt',
        workFolder: testDir,
      });

      expect(response).toBeTruthy();
    });
  });

  describe('Error Recovery', () => {
    it('should handle Claude CLI not found gracefully', async () => {
      // Create a client with a different binary name that doesn't exist
      const errorClient = createTestClient({ claudeCliName: 'non-existent-claude' });
      await errorClient.connect();
      
      await expect(
        errorClient.callTool('run', {
          prompt: 'Test prompt',
          workFolder: testDir,
        })
      ).rejects.toThrow();
      
      await errorClient.disconnect();
    });

    it('should handle permission denied errors', async () => {
      const restrictedDir = '/root/restricted';
      
      // Non-existent directories now throw an error
      await expect(
        client.callTool('run', {
          prompt: 'Test prompt',
          workFolder: restrictedDir,
        })
      ).rejects.toThrow(/does not exist/i);
    });
  });

  describe('Concurrent Requests', () => {
    it('should handle multiple simultaneous requests', async () => {
      const promises = Array(5).fill(null).map((_, i) => 
        client.callTool('run', {
          prompt: `Create file test${i}.txt`,
          workFolder: testDir,
        })
      );

      const results = await Promise.allSettled(promises);
      const successful = results.filter(r => r.status === 'fulfilled');

      const failures = results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => r.reason?.message ?? String(r.reason));

      expect(successful.length, `Concurrent run failures: ${failures.join(' | ')}`).toBeGreaterThan(0);
    });
  });

  describe('Large Prompts', () => {
    it('should handle very long prompts', async () => {
      const longPrompt = 'Create a file with content: ' + 'x'.repeat(10000);
      
      const response = await client.callTool('run', {
        prompt: longPrompt,
        workFolder: testDir,
      });

      expect(response).toBeTruthy();
    });
  });

  describe('Invalid Working Directory', () => {
    it('should reject a workFolder that is a file', async () => {
      const workFolderFile = join(testDir, 'not-a-directory');
      writeFileSync(workFolderFile, 'not a directory');

      await expect(
        client.callTool('run', {
          prompt: 'Read file',
          workFolder: workFolderFile,
        })
      ).rejects.toThrow('Failed to start claude CLI process');
    });
  });
});
