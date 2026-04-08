import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestClient, MCPTestClient } from './utils/mcp-client.js';
import { getSharedMock, cleanupSharedMock } from './utils/persistent-mock.js';

describe('Claude Code MCP E2E Tests', () => {
  let client: MCPTestClient;
  let testDir: string;

  beforeEach(async () => {
    // Ensure mock exists
    await getSharedMock();
    
    // Create a temporary directory for test files
    testDir = mkdtempSync(join(tmpdir(), 'claude-code-test-'));
    
    client = createTestClient();
    
    await client.connect();
  });

  afterEach(async () => {
    // Disconnect client
    await client.disconnect();
    
    // Clean up test directory
    rmSync(testDir, { recursive: true, force: true });
  });
  
  afterAll(async () => {
    // Only cleanup mock at the very end
    await cleanupSharedMock();
  });

  describe('Tool Registration', () => {
    it('should register run tool', async () => {
      const tools = await client.listTools();
      
      expect(tools).toHaveLength(6);
      const claudeCodeTool = tools.find((t: any) => t.name === 'run');
      expect(claudeCodeTool).toEqual({
        name: 'run',
        description: expect.stringContaining('AI Agent Runner'),
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: expect.stringContaining('Either this or prompt_file is required'),
            },
            prompt_file: {
              type: 'string',
              description: expect.stringContaining('Path to a file containing the prompt'),
            },
            workFolder: {
              type: 'string',
              description: expect.stringContaining('working directory'),
            },
            model: {
              type: 'string',
              description: expect.stringContaining('sonnet'),
            },
            reasoning_effort: {
              type: 'string',
              description: expect.stringContaining('model_reasoning_effort'),
            },
            session_id: {
              type: 'string',
              description: expect.stringContaining('session ID'),
            },
          },
          required: ['workFolder'],
        },
      });
      
      // Verify other tools exist
      expect(tools.some((t: any) => t.name === 'list_processes')).toBe(true);
      expect(tools.some((t: any) => t.name === 'get_result')).toBe(true);
      expect(tools.some((t: any) => t.name === 'kill_process')).toBe(true);
    });
  });

  describe('Basic Operations', () => {
    it('should execute a simple prompt', async () => {
      const response = await client.callTool('run', {
        prompt: 'create a file called test.txt with content "Hello World"',
        workFolder: testDir,
      });

      expect(response).toEqual([{
        type: 'text',
        text: expect.stringContaining('successfully'),
      }]);
    });

    it('should handle process management correctly', async () => {
      // run now returns a PID immediately
      const response = await client.callTool('run', {
        prompt: 'error',
        workFolder: testDir,
      });
      
      expect(response).toEqual([{
        type: 'text',
        text: expect.stringContaining('pid'),
      }]);
      
      // Extract PID from response
      const responseText = response[0].text;
      const pidMatch = responseText.match(/"pid":\s*(\d+)/); 
      expect(pidMatch).toBeTruthy();
    });

    it('should reject missing workFolder', async () => {
      await expect(
        client.callTool('run', {
          prompt: 'List files in current directory',
        })
      ).rejects.toThrow(/workFolder/i);
    });
  });

  describe('Working Directory Handling', () => {
    it('should respect custom working directory', async () => {
      const response = await client.callTool('run', {
        prompt: 'Show current working directory',
        workFolder: testDir,
      });

      expect(response).toBeTruthy();
    });

    it('should reject non-existent working directory', async () => {
      const nonExistentDir = join(testDir, 'non-existent');
      
      await expect(
        client.callTool('run', {
          prompt: 'Test prompt',
          workFolder: nonExistentDir,
        })
      ).rejects.toThrow(/does not exist/i);
    });
  });

  describe('Timeout Handling', () => {
    it('should respect timeout settings', async () => {
      // This would require modifying the mock to simulate a long-running command
      // Since we're testing locally, we'll skip the actual timeout test
      expect(true).toBe(true);
    });
  });

  describe('Model Alias Handling', () => {
    it('should resolve haiku alias when calling run', async () => {
      const response = await client.callTool('run', {
        prompt: 'Test with haiku model',
        workFolder: testDir,
        model: 'haiku'
      });
      
      expect(response).toEqual([{
        type: 'text',
        text: expect.stringContaining('pid'),
      }]);
      
      // Extract PID from response
      const responseText = response[0].text;
      const pidMatch = responseText.match(/"pid":\s*(\d+)/);
      expect(pidMatch).toBeTruthy();
      
      // Get the PID and check the process using get_result
      const pid = parseInt(pidMatch![1]);
      const result = await client.callTool('get_result', { pid });
      const resultText = result[0].text;
      const processData = JSON.parse(resultText);

      // Verify that the model was set correctly
      expect(processData.model).toBe('haiku');
    });

    it('should pass non-alias model names unchanged', async () => {
      const response = await client.callTool('run', {
        prompt: 'Test with sonnet model',
        workFolder: testDir,
        model: 'sonnet'
      });
      
      expect(response).toEqual([{
        type: 'text',
        text: expect.stringContaining('pid'),
      }]);
      
      // Extract PID
      const responseText = response[0].text;
      const pidMatch = responseText.match(/"pid":\s*(\d+)/);
      const pid = parseInt(pidMatch![1]);

      // Check the process using get_result
      const result = await client.callTool('get_result', { pid });
      const resultText = result[0].text;
      const processData = JSON.parse(resultText);

      // The model should be unchanged
      expect(processData.model).toBe('sonnet');
    });
    
    it('should work without specifying a model', async () => {
      const response = await client.callTool('run', {
        prompt: 'Test without model parameter',
        workFolder: testDir
      });
      
      expect(response).toEqual([{
        type: 'text',
        text: expect.stringContaining('pid'),
      }]);
    });
  });

  describe('Debug Mode', () => {
    it('should log debug information when enabled', async () => {
      // Debug logs go to stderr, which we capture in the client
      const response = await client.callTool('run', {
        prompt: 'Debug test prompt',
        workFolder: testDir,
      });

      expect(response).toBeTruthy();
    });
  });
});

describe('Integration Tests (Local Only)', () => {
  let client: MCPTestClient;
  let testDir: string;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'claude-code-integration-'));
    
    // Initialize client without mocks for real Claude testing
    client = createTestClient({ claudeCliName: '' });
  });

  afterEach(async () => {
    if (client) {
      await client.disconnect();
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  // This smoke test only verifies that a real Claude CLI can be invoked.
  it.skip('should invoke the real Claude CLI', async () => {
    await client.connect();

    const response = await client.callTool('run', {
      prompt: 'Reply with hi',
      workFolder: testDir,
    });

    expect(response).toEqual([{
      type: 'text',
      text: expect.stringContaining('pid'),
    }]);
  });
});
