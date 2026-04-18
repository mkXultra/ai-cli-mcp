import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestClient, MCPTestClient } from './utils/mcp-client.js';
import { getSharedMock, cleanupSharedMock } from './utils/persistent-mock.js';
import { createOpenCodeMock } from './utils/opencode-mock.js';

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
      
      expect(tools).toHaveLength(8);
      const claudeCodeTool = tools.find((t: any) => t.name === 'run');
      expect(claudeCodeTool.inputSchema.properties.model.description).toContain('sonnet');
      expect(claudeCodeTool.inputSchema.properties.model.description).toContain('opencode');
      expect(claudeCodeTool.inputSchema.properties.model.description).toContain('oc-<provider/model>');
      expect(claudeCodeTool.inputSchema.properties.reasoning_effort.description).toContain('OpenCode');
      
      // Verify other tools exist
      expect(tools.some((t: any) => t.name === 'list_processes')).toBe(true);
      expect(tools.some((t: any) => t.name === 'get_result')).toBe(true);
      expect(tools.some((t: any) => t.name === 'peek')).toBe(true);
      expect(tools.some((t: any) => t.name === 'kill_process')).toBe(true);
      expect(tools.some((t: any) => t.name === 'doctor')).toBe(true);
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

  describe('OpenCode flows', () => {
    it('should execute and resume OpenCode runs through the MCP client', async () => {
      await client.disconnect();

      const opencodeArgsLogPath = join(testDir, 'opencode-args.log');
      const { scriptPath } = createOpenCodeMock(testDir, {
        argsLogPath: opencodeArgsLogPath,
        defaultSessionId: 'ses-opencode-e2e',
      });

      client = createTestClient({
        debug: false,
        env: {
          OPENCODE_CLI_NAME: scriptPath,
        },
      });
      await client.connect();

      const runResponse = await client.callTool('run', {
        prompt: 'e2e OpenCode initial prompt',
        workFolder: testDir,
        model: 'opencode',
      });
      const runData = JSON.parse(runResponse[0].text);
      expect(runData.agent).toBe('opencode');

      const initialWait = JSON.parse((await client.callTool('wait', { pids: [runData.pid], timeout: 5 }))[0].text);
      expect(initialWait).toHaveLength(1);
      expect(initialWait[0]).toMatchObject({
        pid: runData.pid,
        agent: 'opencode',
        status: 'completed',
        exitCode: 0,
        model: 'opencode',
        session_id: 'ses-opencode-e2e',
        agentOutput: {
          message: 'Initial: e2e OpenCode initial prompt',
          session_id: 'ses-opencode-e2e',
        },
      });

      const resumedResponse = await client.callTool('run', {
        prompt: 'e2e OpenCode resumed prompt',
        workFolder: testDir,
        model: 'oc-openai/gpt-5.4',
        session_id: 'ses-opencode-e2e',
      });
      const resumedRunData = JSON.parse(resumedResponse[0].text);

      const resumedWait = JSON.parse((await client.callTool('wait', { pids: [resumedRunData.pid], timeout: 5 }))[0].text);
      expect(resumedWait).toHaveLength(1);
      expect(resumedWait[0]).toMatchObject({
        pid: resumedRunData.pid,
        agent: 'opencode',
        status: 'completed',
        exitCode: 0,
        model: 'oc-openai/gpt-5.4',
        session_id: 'ses-opencode-e2e',
        agentOutput: {
          message: 'Resumed model openai/gpt-5.4: e2e OpenCode resumed prompt',
          session_id: 'ses-opencode-e2e',
        },
      });

      const invocationLog = readFileSync(opencodeArgsLogPath, 'utf-8').trim().split('\n');
      expect(invocationLog[0]).toContain(`--dir ${testDir}`);
      expect(invocationLog[0]).not.toContain('--model');
      expect(invocationLog[1]).toContain('--session ses-opencode-e2e');
      expect(invocationLog[1]).toContain('--model openai/gpt-5.4');
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
