#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type ServerResult,
} from '@modelcontextprotocol/sdk/types.js';
import { spawn, ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as path from 'path';
import { parseCodexOutput, parseClaudeOutput, parseGeminiOutput } from './parsers.js';
import { buildCliCommand } from './cli-builder.js';

// Server version - update this when releasing new versions
const SERVER_VERSION = "2.2.0";

// Define debugMode globally using const
const debugMode = process.env.MCP_CLAUDE_DEBUG === 'true';

// Track if this is the first tool use for version printing
let isFirstToolUse = true;

// Capture server startup time when the module loads
const serverStartupTime = new Date().toISOString();

// Process tracking
interface ClaudeProcess {
  pid: number;
  process: ChildProcess;
  prompt: string;
  workFolder: string;
  model?: string;
  toolType: 'claude' | 'codex' | 'gemini';  // Identify which CLI tool
  startTime: string;
  stdout: string;
  stderr: string;
  status: 'running' | 'completed' | 'failed';
  exitCode?: number;
}

// Type definition for list_processes return value
interface ProcessListItem {
  pid: number;                                // プロセスID
  agent: 'claude' | 'codex' | 'gemini';      // エージェントタイプ
  status: 'running' | 'completed' | 'failed'; // プロセスの状態
}

// Global process manager
const processManager = new Map<number, ClaudeProcess>();

// Dedicated debug logging function
export function debugLog(message?: any, ...optionalParams: any[]): void {
  if (debugMode) {
    console.error(message, ...optionalParams);
  }
}

/**
 * Determine the Gemini CLI command/path.
 * Similar to findClaudeCli but for Gemini
 */
export function findGeminiCli(): string {
  debugLog('[Debug] Attempting to find Gemini CLI...');

  // Check for custom CLI name from environment variable
  const customCliName = process.env.GEMINI_CLI_NAME;
  if (customCliName) {
    debugLog(`[Debug] Using custom Gemini CLI name from GEMINI_CLI_NAME: ${customCliName}`);

    // If it's an absolute path, use it directly
    if (path.isAbsolute(customCliName)) {
      debugLog(`[Debug] GEMINI_CLI_NAME is an absolute path: ${customCliName}`);
      return customCliName;
    }

    // If it starts with ~ or ./, reject as relative paths are not allowed
    if (customCliName.startsWith('./') || customCliName.startsWith('../') || customCliName.includes('/')) {
      throw new Error(`Invalid GEMINI_CLI_NAME: Relative paths are not allowed. Use either a simple name (e.g., 'gemini') or an absolute path (e.g., '/tmp/gemini-test')`);
    }
  }

  const cliName = customCliName || 'gemini';

  // Try local install path: ~/.gemini/local/gemini
  const userPath = join(homedir(), '.gemini', 'local', 'gemini');
  debugLog(`[Debug] Checking for Gemini CLI at local user path: ${userPath}`);

  if (existsSync(userPath)) {
    debugLog(`[Debug] Found Gemini CLI at local user path: ${userPath}. Using this path.`);
    return userPath;
  } else {
    debugLog(`[Debug] Gemini CLI not found at local user path: ${userPath}.`);
  }

  // Fallback to CLI name (PATH lookup)
  debugLog(`[Debug] Falling back to "${cliName}" command name, relying on spawn/PATH lookup.`);
  console.warn(`[Warning] Gemini CLI not found at ~/.gemini/local/gemini. Falling back to "${cliName}" in PATH. Ensure it is installed and accessible.`);
  return cliName;
}

/**
 * Determine the Codex CLI command/path.
 * Similar to findClaudeCli but for Codex
 */
export function findCodexCli(): string {
  debugLog('[Debug] Attempting to find Codex CLI...');

  // Check for custom CLI name from environment variable
  const customCliName = process.env.CODEX_CLI_NAME;
  if (customCliName) {
    debugLog(`[Debug] Using custom Codex CLI name from CODEX_CLI_NAME: ${customCliName}`);
    
    // If it's an absolute path, use it directly
    if (path.isAbsolute(customCliName)) {
      debugLog(`[Debug] CODEX_CLI_NAME is an absolute path: ${customCliName}`);
      return customCliName;
    }
    
    // If it starts with ~ or ./, reject as relative paths are not allowed
    if (customCliName.startsWith('./') || customCliName.startsWith('../') || customCliName.includes('/')) {
      throw new Error(`Invalid CODEX_CLI_NAME: Relative paths are not allowed. Use either a simple name (e.g., 'codex') or an absolute path (e.g., '/tmp/codex-test')`);
    }
  }
  
  const cliName = customCliName || 'codex';

  // Try local install path: ~/.codex/local/codex
  const userPath = join(homedir(), '.codex', 'local', 'codex');
  debugLog(`[Debug] Checking for Codex CLI at local user path: ${userPath}`);

  if (existsSync(userPath)) {
    debugLog(`[Debug] Found Codex CLI at local user path: ${userPath}. Using this path.`);
    return userPath;
  } else {
    debugLog(`[Debug] Codex CLI not found at local user path: ${userPath}.`);
  }

  // Fallback to CLI name (PATH lookup)
  debugLog(`[Debug] Falling back to "${cliName}" command name, relying on spawn/PATH lookup.`);
  console.warn(`[Warning] Codex CLI not found at ~/.codex/local/codex. Falling back to "${cliName}" in PATH. Ensure it is installed and accessible.`);
  return cliName;
}

/**
 * Determine the Claude CLI command/path.
 * 1. Checks for CLAUDE_CLI_NAME environment variable:
 *    - If absolute path, uses it directly
 *    - If relative path, throws error
 *    - If simple name, continues with path resolution
 * 2. Checks for Claude CLI at the local user path: ~/.claude/local/claude.
 * 3. If not found, defaults to the CLI name (or 'claude'), relying on the system's PATH for lookup.
 */
export function findClaudeCli(): string {
  debugLog('[Debug] Attempting to find Claude CLI...');

  // Check for custom CLI name from environment variable
  const customCliName = process.env.CLAUDE_CLI_NAME;
  if (customCliName) {
    debugLog(`[Debug] Using custom Claude CLI name from CLAUDE_CLI_NAME: ${customCliName}`);
    
    // If it's an absolute path, use it directly
    if (path.isAbsolute(customCliName)) {
      debugLog(`[Debug] CLAUDE_CLI_NAME is an absolute path: ${customCliName}`);
      return customCliName;
    }
    
    // If it starts with ~ or ./, reject as relative paths are not allowed
    if (customCliName.startsWith('./') || customCliName.startsWith('../') || customCliName.includes('/')) {
      throw new Error(`Invalid CLAUDE_CLI_NAME: Relative paths are not allowed. Use either a simple name (e.g., 'claude') or an absolute path (e.g., '/tmp/claude-test')`);
    }
  }
  
  const cliName = customCliName || 'claude';

  // Try local install path: ~/.claude/local/claude (using the original name for local installs)
  const userPath = join(homedir(), '.claude', 'local', 'claude');
  debugLog(`[Debug] Checking for Claude CLI at local user path: ${userPath}`);

  if (existsSync(userPath)) {
    debugLog(`[Debug] Found Claude CLI at local user path: ${userPath}. Using this path.`);
    return userPath;
  } else {
    debugLog(`[Debug] Claude CLI not found at local user path: ${userPath}.`);
  }

  // 3. Fallback to CLI name (PATH lookup)
  debugLog(`[Debug] Falling back to "${cliName}" command name, relying on spawn/PATH lookup.`);
  console.warn(`[Warning] Claude CLI not found at ~/.claude/local/claude. Falling back to "${cliName}" in PATH. Ensure it is installed and accessible.`);
  return cliName;
}

// Re-export resolveModelAlias for backward compatibility
export { resolveModelAlias } from './cli-builder.js';

// Ensure spawnAsync is defined correctly *before* the class
export async function spawnAsync(command: string, args: string[], options?: { timeout?: number, cwd?: string }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    debugLog(`[Spawn] Running command: ${command} ${args.join(' ')}`);
    const process = spawn(command, args, {
      shell: false, // Reverted to false
      timeout: options?.timeout,
      cwd: options?.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => { stdout += data.toString(); });
    process.stderr.on('data', (data) => {
      stderr += data.toString();
      debugLog(`[Spawn Stderr Chunk] ${data.toString()}`);
    });

    process.on('error', (error: NodeJS.ErrnoException) => {
      debugLog(`[Spawn Error Event] Full error object:`, error);
      let errorMessage = `Spawn error: ${error.message}`;
      if (error.path) {
        errorMessage += ` | Path: ${error.path}`;
      }
      if (error.syscall) {
        errorMessage += ` | Syscall: ${error.syscall}`;
      }
      errorMessage += `\nStderr: ${stderr.trim()}`;
      reject(new Error(errorMessage));
    });

    process.on('close', (code) => {
      debugLog(`[Spawn Close] Exit code: ${code}`);
      debugLog(`[Spawn Stderr Full] ${stderr.trim()}`);
      debugLog(`[Spawn Stdout Full] ${stdout.trim()}`);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command failed with exit code ${code}\nStderr: ${stderr.trim()}\nStdout: ${stdout.trim()}`));
      }
    });
  });
}

/**
 * MCP Server for Claude Code
 * Provides a simple MCP tool to run Claude CLI in one-shot mode
 */
export class ClaudeCodeServer {
  private server: Server;
  private claudeCliPath: string;
  private codexCliPath: string;
  private geminiCliPath: string;
  private sigintHandler?: () => Promise<void>;
  private packageVersion: string;

  constructor() {
    // Use the simplified findClaudeCli function
    this.claudeCliPath = findClaudeCli(); // Removed debugMode argument
    this.codexCliPath = findCodexCli();
    this.geminiCliPath = findGeminiCli();
    console.error(`[Setup] Using Claude CLI command/path: ${this.claudeCliPath}`);
    console.error(`[Setup] Using Codex CLI command/path: ${this.codexCliPath}`);
    console.error(`[Setup] Using Gemini CLI command/path: ${this.geminiCliPath}`);
    this.packageVersion = SERVER_VERSION;

    this.server = new Server(
      {
        name: 'ai_cli_mcp',
        version: SERVER_VERSION,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();

    this.server.onerror = (error) => console.error('[Error]', error);
    this.sigintHandler = async () => {
      await this.server.close();
      process.exit(0);
    };
    process.on('SIGINT', this.sigintHandler);
  }

  /**
   * Set up the MCP tool handlers
   */
  private setupToolHandlers(): void {
    // Define available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'run',
          description: `AI Agent Runner: Starts a Claude, Codex, or Gemini CLI process in the background and returns a PID immediately. Use list_processes and get_result to monitor progress.

• File ops: Create, read, (fuzzy) edit, move, copy, delete, list files, analyze/ocr images, file content analysis
• Code: Generate / analyse / refactor / fix
• Git: Stage ▸ commit ▸ push ▸ tag (any workflow)
• Terminal: Run any CLI cmd or open URLs
• Web search + summarise content on-the-fly
• Multi-step workflows & GitHub integration

**IMPORTANT**: This tool now returns immediately with a PID. Use other tools to check status and get results.

**Supported models**:
"claude-ultra", "codex-ultra", "gemini-ultra", "sonnet", "sonnet[1m]", "opus", "opusplan", "haiku", "gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.1-codex-mini", "gpt-5.1-codex-max", "gpt-5.2", "gpt-5.1", "gpt-5.1-codex", "gpt-5-codex", "gpt-5-codex-mini", "gpt-5", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-3.1-pro-preview", "gemini-3-pro-preview", "gemini-3-flash-preview"

**Prompt input**: You must provide EITHER prompt (string) OR prompt_file (file path), but not both.

**Prompt tips**
1. Be concise, explicit & step-by-step for complex tasks.
2. Check process status with list_processes
3. Get results with get_result using the returned PID
4. Kill long-running processes with kill_process if needed

        `,
          inputSchema: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'The detailed natural language prompt for the agent to execute. Either this or prompt_file is required.',
              },
              prompt_file: {
                type: 'string',
                description: 'Path to a file containing the prompt. Either this or prompt is required. Must be an absolute path or relative to workFolder.',
              },
              workFolder: {
                type: 'string',
                description: 'The working directory for the agent execution. Must be an absolute path.',
              },
              model: {
                type: 'string',
                description: 'The model to use. Aliases: "claude-ultra", "codex-ultra" (auto high-reasoning), "gemini-ultra". Standard: "sonnet", "sonnet[1m]", "opus", "opusplan", "haiku", "gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.1-codex-mini", "gpt-5.1", "gemini-2.5-pro", "gemini-3.1-pro-preview", "gemini-3-pro-preview", "gemini-3-flash-preview", etc.',
              },
              reasoning_effort: {
                type: 'string',
                description: 'Codex only. Sets model_reasoning_effort. Allowed: "low", "medium", "high", "xhigh".',
              },
              session_id: {
                type: 'string',
                description: 'Optional session ID to resume a previous session. Supported for: haiku, sonnet, opus, gemini-2.5-pro, gemini-2.5-flash, gemini-3.1-pro-preview, gemini-3-pro-preview, gemini-3-flash-preview.',
              },
            },
            required: ['workFolder'],
          },
        },
        {
          name: 'list_processes',
          description: 'List all running and completed AI agent processes. Returns a simple list with PID, agent type, and status for each process.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'get_result',
          description: 'Get the current output and status of an AI agent process by PID. Returns the output from the agent including session_id (if applicable), along with process metadata.',
          inputSchema: {
            type: 'object',
            properties: {
              pid: {
                type: 'number',
                description: 'The process ID returned by run tool.',
              },
              verbose: {
                type: 'boolean',
                description: 'Optional: If true, returns detailed execution information including tool usage history. Defaults to false.',
              }
            },
            required: ['pid'],
          },
        },
        {
          name: 'wait',
          description: 'Wait for multiple AI agent processes to complete and return their results. Blocks until all specified PIDs finish or timeout occurs.',
          inputSchema: {
            type: 'object',
            properties: {
              pids: {
                type: 'array',
                items: { type: 'number' },
                description: 'List of process IDs to wait for (returned by the run tool).',
              },
              timeout: {
                type: 'number',
                description: 'Optional: Maximum time to wait in seconds. Defaults to 180 (3 minutes).',
              },
            },
            required: ['pids'],
          },
        },
        {
          name: 'kill_process',
          description: 'Terminate a running AI agent process by PID.',
          inputSchema: {
            type: 'object',
            properties: {
              pid: {
                type: 'number',
                description: 'The process ID to terminate.',
              },
            },
            required: ['pid'],
          },
        },
        {
          name: 'cleanup_processes',
          description: 'Remove all completed and failed processes from the process list to free up memory.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        }
      ],
    }));

    // Handle tool calls
    const executionTimeoutMs = 1800000; // 30 minutes timeout

    this.server.setRequestHandler(CallToolRequestSchema, async (args, call): Promise<ServerResult> => {
      debugLog('[Debug] Handling CallToolRequest:', args);

      const toolName = args.params.name;
      const toolArguments = args.params.arguments || {};

      switch (toolName) {
        case 'run':
          return this.handleRun(toolArguments);
        case 'list_processes':
          return this.handleListProcesses();
        case 'get_result':
          return this.handleGetResult(toolArguments);
        case 'wait':
          return this.handleWait(toolArguments);
        case 'kill_process':
          return this.handleKillProcess(toolArguments);
        case 'cleanup_processes':
          return this.handleCleanupProcesses();
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Tool ${toolName} not found`);
      }
    });
  }

  /**
   * Handle run tool - starts Claude or Codex process and returns PID immediately
   */
  private async handleRun(toolArguments: any): Promise<ServerResult> {
    // Print version on first use
    if (isFirstToolUse) {
      console.error(`ai_cli_mcp v${SERVER_VERSION} started at ${serverStartupTime}`);
      isFirstToolUse = false;
    }

    // Build CLI command (validation + args assembly)
    let cmd;
    try {
      cmd = buildCliCommand({
        prompt: toolArguments.prompt,
        prompt_file: toolArguments.prompt_file,
        workFolder: toolArguments.workFolder,
        model: toolArguments.model,
        session_id: toolArguments.session_id,
        reasoning_effort: toolArguments.reasoning_effort,
        cliPaths: {
          claude: this.claudeCliPath,
          codex: this.codexCliPath,
          gemini: this.geminiCliPath,
        },
      });
    } catch (error: any) {
      throw new McpError(ErrorCode.InvalidParams, error.message);
    }

    const { cliPath, args: processArgs, cwd: effectiveCwd, agent, prompt } = cmd;

    // Spawn process without waiting
    const childProcess = spawn(cliPath, processArgs, {
      cwd: effectiveCwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });

    const pid = childProcess.pid;
    if (!pid) {
      throw new McpError(ErrorCode.InternalError, `Failed to start ${agent} CLI process`);
    }

    // Create process tracking entry
    const processEntry: ClaudeProcess = {
      pid,
      process: childProcess,
      prompt,
      workFolder: effectiveCwd,
      model: toolArguments.model,
      toolType: agent,
      startTime: new Date().toISOString(),
      stdout: '',
      stderr: '',
      status: 'running'
    };

    // Track the process
    processManager.set(pid, processEntry);

    // Set up output collection
    childProcess.stdout.on('data', (data) => {
      const entry = processManager.get(pid);
      if (entry) {
        entry.stdout += data.toString();
      }
    });

    childProcess.stderr.on('data', (data) => {
      const entry = processManager.get(pid);
      if (entry) {
        entry.stderr += data.toString();
      }
    });

    childProcess.on('close', (code) => {
      const entry = processManager.get(pid);
      if (entry) {
        entry.status = code === 0 ? 'completed' : 'failed';
        entry.exitCode = code !== null ? code : undefined;
      }
    });

    childProcess.on('error', (error) => {
      const entry = processManager.get(pid);
      if (entry) {
        entry.status = 'failed';
        entry.stderr += `\nProcess error: ${error.message}`;
      }
    });

    // Return PID immediately
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ 
          pid, 
          status: 'started',
          agent,
          message: `${agent} process started successfully`
        }, null, 2)
      }]
    };
  }

  /**
   * Handle list_processes tool
   */
  private async handleListProcesses(): Promise<ServerResult> {
    const processes: ProcessListItem[] = [];

    for (const [pid, process] of processManager.entries()) {
      const processInfo: ProcessListItem = {
        pid,
        agent: process.toolType,
        status: process.status
      };

      processes.push(processInfo);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(processes, null, 2)
      }]
    };
  }

  /**
   * Helper to get process result object
   */
  private getProcessResultHelper(pid: number, verbose: boolean = false): any {
    const process = processManager.get(pid);

    if (!process) {
      throw new McpError(ErrorCode.InvalidParams, `Process with PID ${pid} not found`);
    }

    // Parse output based on agent type
    let agentOutput: any = null;
    if (process.toolType === 'codex') {
      // Codex may output structured logs to stderr
      const combinedOutput = (process.stdout || '') + '\n' + (process.stderr || '');
      agentOutput = parseCodexOutput(combinedOutput);
    } else if (process.stdout) {
      if (process.toolType === 'claude') {
        agentOutput = parseClaudeOutput(process.stdout);
      } else if (process.toolType === 'gemini') {
        agentOutput = parseGeminiOutput(process.stdout);
      }
    }

    // Construct response with agent's output and process metadata
    const response: any = {
      pid,
      agent: process.toolType,
      status: process.status,
      exitCode: process.exitCode,
      startTime: process.startTime,
      workFolder: process.workFolder,
      prompt: process.prompt,
      model: process.model
    };

    // If we have valid output from agent, include it
    if (agentOutput) {
      // Filter out tools if not verbose
      if (!verbose && agentOutput.tools) {
        const { tools, ...rest } = agentOutput;
        response.agentOutput = rest;
      } else {
        response.agentOutput = agentOutput;
      }
      
      // Extract session_id if available
      if (agentOutput.session_id) {
        response.session_id = agentOutput.session_id;
      }
    } else {
      // Fallback to raw output
      response.stdout = process.stdout;
      response.stderr = process.stderr;
    }
    
    return response;
  }

  /**
   * Handle get_result tool
   */
  private async handleGetResult(toolArguments: any): Promise<ServerResult> {
    if (!toolArguments.pid || typeof toolArguments.pid !== 'number') {
      throw new McpError(ErrorCode.InvalidParams, 'Missing or invalid required parameter: pid');
    }

    const pid = toolArguments.pid;
    const verbose = !!toolArguments.verbose;
    const response = this.getProcessResultHelper(pid, verbose);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }]
    };
  }

  /**
   * Handle wait tool
   */
  private async handleWait(toolArguments: any): Promise<ServerResult> {
    if (!toolArguments.pids || !Array.isArray(toolArguments.pids) || toolArguments.pids.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'Missing or invalid required parameter: pids (must be a non-empty array of numbers)');
    }

    const pids: number[] = toolArguments.pids;
    // Default timeout: 3 minutes (180 seconds)
    const timeoutSeconds = typeof toolArguments.timeout === 'number' ? toolArguments.timeout : 180;
    const timeoutMs = timeoutSeconds * 1000;

    // Validate all PIDs exist first
    for (const pid of pids) {
      if (!processManager.has(pid)) {
        throw new McpError(ErrorCode.InvalidParams, `Process with PID ${pid} not found`);
      }
    }

    // Create promises for each process
    const waitPromises = pids.map(pid => {
      const processEntry = processManager.get(pid)!;
      
      if (processEntry.status !== 'running') {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        processEntry.process.once('close', () => {
          resolve();
        });
      });
    });

    // Create a timeout promise
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Timed out after ${timeoutSeconds} seconds waiting for processes`));
      }, timeoutMs);
    });

    try {
      // Wait for all processes to finish or timeout
      await Promise.race([Promise.all(waitPromises), timeoutPromise]);
    } catch (error: any) {
      throw new McpError(ErrorCode.InternalError, error.message);
    }

    // Collect results (verbose=false for wait)
    const results = pids.map(pid => this.getProcessResultHelper(pid, false));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(results, null, 2)
      }]
    };
  }

  /**
   * Handle kill_process tool
   */

  private async handleKillProcess(toolArguments: any): Promise<ServerResult> {
    if (!toolArguments.pid || typeof toolArguments.pid !== 'number') {
      throw new McpError(ErrorCode.InvalidParams, 'Missing or invalid required parameter: pid');
    }

    const pid = toolArguments.pid;
    const processEntry = processManager.get(pid);

    if (!processEntry) {
      throw new McpError(ErrorCode.InvalidParams, `Process with PID ${pid} not found`);
    }

    if (processEntry.status !== 'running') {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            pid,
            status: processEntry.status,
            message: 'Process already terminated'
          }, null, 2)
        }]
      };
    }

    try {
      processEntry.process.kill('SIGTERM');
      processEntry.status = 'failed';
      processEntry.stderr += '\nProcess terminated by user';
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            pid,
            status: 'terminated',
            message: 'Process terminated successfully'
          }, null, 2)
        }]
      };
    } catch (error: any) {
      throw new McpError(ErrorCode.InternalError, `Failed to terminate process: ${error.message}`);
    }
  }

  /**
   * Handle cleanup_processes tool
   */
  private async handleCleanupProcesses(): Promise<ServerResult> {
    const removedPids: number[] = [];

    // Iterate through all processes and collect PIDs to remove
    for (const [pid, process] of processManager.entries()) {
      if (process.status === 'completed' || process.status === 'failed') {
        removedPids.push(pid);
        processManager.delete(pid);
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          removed: removedPids.length,
          removedPids,
          message: `Cleaned up ${removedPids.length} finished process(es)`
        }, null, 2)
      }]
    };
  }

  /**
   * Start the MCP server
   */
  async run(): Promise<void> {
    // Revert to original server start logic if listen caused errors
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('AI CLI MCP server running on stdio');
  }

  /**
   * Clean up resources (for testing)
   */
  async cleanup(): Promise<void> {
    if (this.sigintHandler) {
      process.removeListener('SIGINT', this.sigintHandler);
    }
    await this.server.close();
  }
}

// Create and run the server (skip during tests)
if (!process.env.VITEST) {
  const server = new ClaudeCodeServer();
  server.run().catch(console.error);
}
