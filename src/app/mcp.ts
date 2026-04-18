import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type ServerResult,
} from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { debugLog, getCliDoctorStatus, type CliBinaryStatus } from '../cli-utils.js';
import { getModelParameterDescription, getModelsPayload, getSupportedModelsDescription } from '../model-catalog.js';
import { validatePeekPids, validatePeekTimeSec } from '../peek.js';
import { ProcessService } from '../process-service.js';

const require = createRequire(import.meta.url);
const SERVER_VERSION = (require('../../package.json') as { version: string }).version;

// Track if this is the first tool use for version printing
let isFirstToolUse = true;

// Capture server startup time when the module loads
const serverStartupTime = new Date().toISOString();

// Ensure spawnAsync is defined correctly *before* the class
export async function spawnAsync(command: string, args: string[], options?: { timeout?: number, cwd?: string }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    debugLog(`[Spawn] Running command: ${command} ${args.join(' ')}`);
    const process = spawn(command, args, {
      shell: false,
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

export class ClaudeCodeServer {
  private server: Server;
  private claudeCliPath: string;
  private codexCliPath: string;
  private geminiCliPath: string;
  private forgeCliPath: string;
  private opencodeCliPath: string;
  private processService: ProcessService;
  private sigintHandler?: () => Promise<void>;

  constructor() {
    const doctorStatus = getCliDoctorStatus();
    this.claudeCliPath = this.resolveDoctorCliPath(doctorStatus.claude);
    this.codexCliPath = this.resolveDoctorCliPath(doctorStatus.codex);
    this.geminiCliPath = this.resolveDoctorCliPath(doctorStatus.gemini);
    this.forgeCliPath = this.resolveDoctorCliPath(doctorStatus.forge);
    this.opencodeCliPath = this.resolveDoctorCliPath(doctorStatus.opencode);
    console.error(`[Setup] Using Claude CLI command/path: ${this.claudeCliPath}`);
    console.error(`[Setup] Using Codex CLI command/path: ${this.codexCliPath}`);
    console.error(`[Setup] Using Gemini CLI command/path: ${this.geminiCliPath}`);
    console.error(`[Setup] Using Forge CLI command/path: ${this.forgeCliPath}`);
    console.error(`[Setup] Using OpenCode CLI command/path: ${this.opencodeCliPath}`);
    this.processService = new ProcessService({
      cliPaths: {
        claude: this.claudeCliPath,
        codex: this.codexCliPath,
        gemini: this.geminiCliPath,
        forge: this.forgeCliPath,
        opencode: this.opencodeCliPath,
      },
    });

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

  private resolveDoctorCliPath(status: CliBinaryStatus): string {
    return status.resolvedPath || status.configuredCommand;
  }

  private getCliConfigurationError(): string | null {
    const doctorStatus = getCliDoctorStatus();
    for (const name of ['claude', 'codex', 'gemini', 'forge', 'opencode'] as const) {
      if (doctorStatus[name].error) {
        return doctorStatus[name].error;
      }
    }
    return null;
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'run',
          description: `AI Agent Runner: Starts a Claude, Codex, Gemini, Forge, or OpenCode CLI process in the background and returns a PID immediately. Use list_processes and get_result to monitor progress.

• File ops: Create, read, (fuzzy) edit, move, copy, delete, list files, analyze/ocr images, file content analysis
• Code: Generate / analyse / refactor / fix
• Git: Stage ▸ commit ▸ push ▸ tag (any workflow)
• Terminal: Run any CLI cmd or open URLs
• Web search + summarise content on-the-fly
• Multi-step workflows & GitHub integration

**IMPORTANT**: This tool now returns immediately with a PID. Use other tools to check status and get results.

**Supported models**:
${getSupportedModelsDescription()}

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
                description: getModelParameterDescription(),
              },
              reasoning_effort: {
                type: 'string',
                description: 'Reasoning control for Claude and Codex. Claude uses --effort with "low", "medium", "high", "xhigh", "max". Codex uses model_reasoning_effort with "low", "medium", "high", "xhigh". Gemini, Forge, and OpenCode do not support reasoning_effort in this integration.',
              },
              session_id: {
                type: 'string',
                description: 'Optional session ID to resume a previous session. Supported for Claude, Codex, Gemini, Forge, and OpenCode. OpenCode resumes in-place via --session and may also be combined with explicit oc-<provider/model> selection.',
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
          description: 'Get the current output and status of an AI agent process by PID. Defaults to a compact result shape; set verbose to true for full metadata and detailed parsed output.',
          inputSchema: {
            type: 'object',
            properties: {
              pid: {
                type: 'number',
                description: 'The process ID returned by run tool.',
              },
              verbose: {
                type: 'boolean',
                description: 'Optional: If true, returns the full result shape including metadata fields and detailed parsed output such as tool usage history. Defaults to false.',
              }
            },
            required: ['pid'],
          },
        },
        {
          name: 'wait',
          description: 'Wait for multiple AI agent processes to complete and return their results. Defaults to compact result items; set verbose to true for full metadata and detailed parsed output.',
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
              verbose: {
                type: 'boolean',
                description: 'Optional: If true, each result item uses the full result shape including metadata fields and detailed parsed output. Defaults to false.',
              },
            },
            required: ['pids'],
          },
        },
        {
          name: 'peek',
          description: 'One-shot short observation window for running child agents. Returns only natural-language message events, and optionally normalized tool_call events, observed during this call; not a history API, not gapless streaming, and not stdout/stderr tailing. In v1, message extraction is supported for Codex, Claude, OpenCode, Gemini, and best-effort Forge Summary/Completed successfully lines. Forge tool calls are low-precision Execute/Finished markers and never include command output. Tool calls exclude raw tool output.',
          inputSchema: {
            type: 'object',
            properties: {
              pids: {
                type: 'array',
                items: { type: 'number' },
                description: 'Process IDs returned by run. Duplicates are deduplicated server-side, preserving first occurrence order. Unknown PIDs are returned per process as not_found.',
              },
              peek_time_sec: {
                type: 'number',
                description: 'Optional positive integer observation window in seconds. Defaults to 10; maximum is 60.',
              },
              include_tool_calls: {
                type: 'boolean',
                description: 'Optional: include normalized tool_call events without raw tool output. Defaults to false.',
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
        },
        {
          name: 'doctor',
          description: 'Check supported AI CLI binary availability and path resolution. Does not verify login state or terms acceptance.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'models',
          description: 'List supported model names, model aliases, and dynamic backend discovery hints.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        }
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (args): Promise<ServerResult> => {
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
        case 'peek':
          return this.handlePeek(toolArguments);
        case 'kill_process':
          return this.handleKillProcess(toolArguments);
        case 'cleanup_processes':
          return this.handleCleanupProcesses();
        case 'doctor':
          return this.handleDoctor();
        case 'models':
          return this.handleModels();
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Tool ${toolName} not found`);
      }
    });
  }

  private async handleRun(toolArguments: any): Promise<ServerResult> {
    if (isFirstToolUse) {
      console.error(`ai_cli_mcp v${SERVER_VERSION} started at ${serverStartupTime}`);
      isFirstToolUse = false;
    }

    const cliConfigurationError = this.getCliConfigurationError();
    if (cliConfigurationError) {
      throw new McpError(ErrorCode.InvalidParams, cliConfigurationError);
    }

    try {
      const result = this.processService.startProcess({
        prompt: toolArguments.prompt,
        prompt_file: toolArguments.prompt_file,
        workFolder: toolArguments.workFolder,
        model: toolArguments.model,
        session_id: toolArguments.session_id,
        reasoning_effort: toolArguments.reasoning_effort,
      });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }]
      };
    } catch (error: any) {
      const code = /Failed to start/.test(error.message) ? ErrorCode.InternalError : ErrorCode.InvalidParams;
      throw new McpError(code, error.message);
    }
  }

  private async handleListProcesses(): Promise<ServerResult> {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(this.processService.listProcesses(), null, 2)
      }]
    };
  }

  private async handleGetResult(toolArguments: any): Promise<ServerResult> {
    if (!toolArguments.pid || typeof toolArguments.pid !== 'number') {
      throw new McpError(ErrorCode.InvalidParams, 'Missing or invalid required parameter: pid');
    }

    const pid = toolArguments.pid;
    const verbose = !!toolArguments.verbose;
    try {
      const response = this.processService.getProcessResult(pid, verbose);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }]
      };
    } catch (error: any) {
      const code = /not found/.test(error.message) ? ErrorCode.InvalidParams : ErrorCode.InternalError;
      throw new McpError(code, error.message);
    }
  }

  private async handleWait(toolArguments: any): Promise<ServerResult> {
    if (!toolArguments.pids || !Array.isArray(toolArguments.pids) || toolArguments.pids.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'Missing or invalid required parameter: pids (must be a non-empty array of numbers)');
    }
    try {
      const results = await this.processService.waitForProcesses(
        toolArguments.pids,
        typeof toolArguments.timeout === 'number' ? toolArguments.timeout : 180,
        !!toolArguments.verbose
      );
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(results, null, 2)
        }]
      };
    } catch (error: any) {
      const code = /not found/.test(error.message) ? ErrorCode.InvalidParams : ErrorCode.InternalError;
      throw new McpError(code, error.message);
    }
  }

  private async handlePeek(toolArguments: any): Promise<ServerResult> {
    let pids: number[];
    let peekTimeSec: number;
    let includeToolCalls: boolean;

    try {
      pids = validatePeekPids(toolArguments.pids);
      peekTimeSec = validatePeekTimeSec(toolArguments.peek_time_sec);
      if (toolArguments.include_tool_calls !== undefined && typeof toolArguments.include_tool_calls !== 'boolean') {
        throw new Error('include_tool_calls must be a boolean when provided');
      }
      includeToolCalls = toolArguments.include_tool_calls === true;
    } catch (error: any) {
      throw new McpError(ErrorCode.InvalidParams, error.message);
    }

    try {
      const response = await this.processService.peekProcesses(pids, peekTimeSec, includeToolCalls);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }]
      };
    } catch (error: any) {
      throw new McpError(ErrorCode.InternalError, `Failed to peek processes: ${error.message}`);
    }
  }

  private async handleKillProcess(toolArguments: any): Promise<ServerResult> {
    if (!toolArguments.pid || typeof toolArguments.pid !== 'number') {
      throw new McpError(ErrorCode.InvalidParams, 'Missing or invalid required parameter: pid');
    }

    const pid = toolArguments.pid;
    try {
      const response = this.processService.killProcess(pid);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }]
      };
    } catch (error: any) {
      const code = /not found/.test(error.message) ? ErrorCode.InvalidParams : ErrorCode.InternalError;
      const message = code === ErrorCode.InternalError
        ? `Failed to terminate process: ${error.message}`
        : error.message;
      throw new McpError(code, message);
    }
  }

  private async handleCleanupProcesses(): Promise<ServerResult> {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(this.processService.cleanupProcesses(), null, 2)
      }]
    };
  }

  private async handleDoctor(): Promise<ServerResult> {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(getCliDoctorStatus(), null, 2)
      }]
    };
  }

  private async handleModels(): Promise<ServerResult> {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(getModelsPayload(), null, 2)
      }]
    };
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('AI CLI MCP server running on stdio');
  }

  async cleanup(): Promise<void> {
    if (this.sigintHandler) {
      process.removeListener('SIGINT', this.sigintHandler);
    }
    await this.server.close();
  }
}

export async function runMcpServer(): Promise<void> {
  const server = new ClaudeCodeServer();
  await server.run();
}
