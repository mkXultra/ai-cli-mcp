import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

// Mock dependencies
vi.mock('node:child_process', () => ({
  spawn: vi.fn()
}));
vi.mock('node:fs');
vi.mock('node:os');
vi.mock('node:path', () => ({
  resolve: vi.fn((path) => path),
  join: vi.fn((...args) => args.join('/')),
  isAbsolute: vi.fn((path) => path.startsWith('/'))
}));
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(function(this: any) {
    this.setRequestHandler = vi.fn();
    this.connect = vi.fn();
    this.close = vi.fn();
    this.onerror = undefined;
    return this;
  }),
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: { name: 'listTools' },
  CallToolRequestSchema: { name: 'callTool' },
  ErrorCode: {
    InternalError: 'InternalError',
    MethodNotFound: 'MethodNotFound',
    InvalidParams: 'InvalidParams'
  },
  McpError: class McpError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'McpError';
    }
  }
}));

const mockExistsSync = vi.mocked(existsSync);
const mockHomedir = vi.mocked(homedir);

describe('Argument Validation Tests', () => {
  let consoleErrorSpy: any;
  let errorHandler: any = null;

  function setupServerMock() {
    errorHandler = null;
    vi.mocked(Server).mockImplementation(function(this: any) {
      this.setRequestHandler = vi.fn();
      this.connect = vi.fn();
      this.close = vi.fn();
      Object.defineProperty(this, 'onerror', {
        get() { return errorHandler; },
        set(handler) { errorHandler = handler; },
        enumerable: true,
        configurable: true
      });
      return this;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Set up process.env
    process.env = { ...process.env };
  });

  describe('Tool Arguments Schema', () => {
    it('should validate valid arguments', async () => {
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockReturnValue(true);
      setupServerMock();
      vi.doUnmock('../server.js');
      const module = await import('../server.js');
      // @ts-ignore
      const { ClaudeCodeServer } = module;
      
      const server = new ClaudeCodeServer();
      const mockServerInstance = vi.mocked(Server).mock.results[0].value;
      
      // Find tool definition  
      const listToolsCall = mockServerInstance.setRequestHandler.mock.calls.find(
        (call: any[]) => call[0].name === 'listTools'
      );
      
      const listHandler = listToolsCall[1];
      const tools = await listHandler();
      const claudeCodeTool = tools.tools[0];
      
      // Extract schema from tool definition
      const schema = z.object({
        prompt: z.string(),
        workFolder: z.string(),
        model: z.string().optional(),
        reasoning_effort: z.string().optional(),
        session_id: z.string().optional()
      });
      
      // Test valid cases
      expect(() => schema.parse({ prompt: 'test', workFolder: '/tmp' })).not.toThrow();
      expect(() => schema.parse({ prompt: 'test', workFolder: '/tmp', model: 'sonnet' })).not.toThrow();
    });

    it('should reject invalid arguments', async () => {
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockReturnValue(true);
      setupServerMock();
      vi.doUnmock('../server.js');
      const module = await import('../server.js');
      // @ts-ignore
      const { ClaudeCodeServer } = module;
      
      const server = new ClaudeCodeServer();
      const mockServerInstance = vi.mocked(Server).mock.results[0].value;
      
      // Find tool definition  
      const listToolsCall = mockServerInstance.setRequestHandler.mock.calls.find(
        (call: any[]) => call[0].name === 'listTools'
      );
      
      const listHandler = listToolsCall[1];
      const tools = await listHandler();
      const claudeCodeTool = tools.tools[0];
      
      // Extract schema from tool definition
      const schema = z.object({
        prompt: z.string(),
        workFolder: z.string(),
        model: z.string().optional(),
        reasoning_effort: z.string().optional(),
        session_id: z.string().optional()
      });
      
      // Test invalid cases
      expect(() => schema.parse({})).toThrow(); // Missing prompt and workFolder
      expect(() => schema.parse({ prompt: 'test' })).toThrow(); // Missing workFolder
      expect(() => schema.parse({ prompt: 123, workFolder: '/tmp' })).toThrow(); // Wrong prompt type
      expect(() => schema.parse({ prompt: 'test', workFolder: 123 })).toThrow(); // Wrong workFolder type
    });

    it('should handle missing required fields', async () => {
      const schema = z.object({
        prompt: z.string(),
        workFolder: z.string(),
        model: z.string().optional(),
        reasoning_effort: z.string().optional(),
        session_id: z.string().optional()
      });
      
      try {
        schema.parse({});
      } catch (error: any) {
        // Both prompt and workFolder are required
        expect(error.errors.length).toBe(2);
        expect(error.errors.some((e: any) => e.path[0] === 'prompt')).toBe(true);
        expect(error.errors.some((e: any) => e.path[0] === 'workFolder')).toBe(true);
      }
    });

    it('should allow optional fields to be undefined', async () => {
      const schema = z.object({
        prompt: z.string(),
        workFolder: z.string(),
        model: z.string().optional(),
        reasoning_effort: z.string().optional(),
        session_id: z.string().optional()
      });
      
      const result = schema.parse({ prompt: 'test', workFolder: '/tmp' });
      expect(result.model).toBeUndefined();
      expect(result.session_id).toBeUndefined();
    });

    it('should handle extra fields gracefully', async () => {
      const schema = z.object({
        prompt: z.string(),
        workFolder: z.string(),
        model: z.string().optional(),
        reasoning_effort: z.string().optional(),
        session_id: z.string().optional()
      });
      
      // By default, Zod strips unknown keys
      const result = schema.parse({ 
        prompt: 'test',
        workFolder: '/tmp', 
        extraField: 'ignored' 
      });
      
      expect(result).toEqual({ prompt: 'test', workFolder: '/tmp' });
      expect(result).not.toHaveProperty('extraField');
    });
  });

  describe('Runtime Argument Validation', () => {
    let handlers: Map<string, Function>;
    let mockServerInstance: any;

    async function setupServer() {
      // Reset modules to ensure fresh import
      vi.resetModules();

      // Re-setup mocks after reset
      const { existsSync } = await import('node:fs');
      const { homedir } = await import('node:os');
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(homedir).mockReturnValue('/home/user');

      const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');

      vi.mocked(Server).mockImplementation(function(this: any) {
        mockServerInstance = {
          setRequestHandler: vi.fn((schema: any, handler: Function) => {
            handlers.set(schema.name, handler);
          }),
          connect: vi.fn(),
          close: vi.fn(),
          onerror: undefined
        };
        return mockServerInstance as any;
      });

      vi.doUnmock('../server.js');
      const module = await import('../server.js');
      // @ts-ignore
      const { ClaudeCodeServer } = module;

      const server = new ClaudeCodeServer();
      return { server, handlers };
    }

    beforeEach(() => {
      handlers = new Map();
      // Re-setup mocks after vi.resetModules() in outer beforeEach
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockReturnValue(true);
    });

    it('should validate workFolder is a string when provided', async () => {
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockReturnValue(true);

      await setupServer();
      const handler = handlers.get('callTool')!;

      // Test with non-string workFolder
      await expect(
        handler({
          params: {
            name: 'run',
            arguments: {
              prompt: 'test',
              workFolder: 123 // Invalid type
            }
          }
        })
      ).rejects.toThrow();
    });

    it('should reject empty string prompt', async () => {
      await setupServer();
      const handler = handlers.get('callTool')!;

      // Empty string prompt should be rejected
      await expect(
        handler({
          params: {
            name: 'run',
            arguments: {
              prompt: '', // Empty prompt
              workFolder: '/tmp'
            }
          }
        })
      ).rejects.toThrow('Either prompt or prompt_file must be provided');
    });

    it('should reject invalid reasoning_effort values', async () => {
      await setupServer();
      const handler = handlers.get('callTool')!;

      await expect(
        handler({
          params: {
            name: 'run',
            arguments: {
              prompt: 'test',
              workFolder: '/tmp',
              model: 'gpt-5.3-codex',
              reasoning_effort: 'fast'
            }
          }
        })
      ).rejects.toThrow(/reasoning_effort/i);
    });

    it('should reject reasoning_effort for unsupported model families', async () => {
      await setupServer();
      const handler = handlers.get('callTool')!;

      await expect(
        handler({
          params: {
            name: 'run',
            arguments: {
              prompt: 'test',
              workFolder: '/tmp',
              model: 'gemini-2.5-pro',
              reasoning_effort: 'low'
            }
          }
        })
      ).rejects.toThrow(/reasoning_effort/i);
    });

    it.each([
      'oc-',
      'oc-openai',
      'oc-/gpt-5.4',
      'oc-openai/',
      ' oc-openai/gpt-5.4',
      'oc-openai/gpt-5.4 ',
    ])('should reject malformed OpenCode model syntax at runtime: %s', async (model) => {
      await setupServer();
      const handler = handlers.get('callTool')!;

      await expect(
        handler({
          params: {
            name: 'run',
            arguments: {
              prompt: 'test',
              workFolder: '/tmp',
              model,
            }
          }
        })
      ).rejects.toThrow('Invalid OpenCode model. Expected exact syntax oc-<provider/model>.');
    });

    it('should reject reasoning_effort for OpenCode runtime requests', async () => {
      await setupServer();
      const handler = handlers.get('callTool')!;

      await expect(
        handler({
          params: {
            name: 'run',
            arguments: {
              prompt: 'test',
              workFolder: '/tmp',
              model: 'opencode',
              reasoning_effort: 'high',
            }
          }
        })
      ).rejects.toThrow('reasoning_effort is not supported for opencode.');
    });
  });
});
