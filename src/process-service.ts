import { spawn, type ChildProcess } from 'node:child_process';
import { buildCliCommand, type BuildCliCommandOptions } from './cli-builder.js';
import { parseClaudeOutput, parseCodexOutput, parseForgeOutput, parseGeminiOutput, parseOpenCodeOutput } from './parsers.js';
import { buildProcessResult } from './process-result.js';

export type AgentType = 'claude' | 'codex' | 'gemini' | 'forge' | 'opencode';
export type ProcessStatus = 'running' | 'completed' | 'failed';

interface TrackedProcess {
  pid: number;
  process: ChildProcess;
  prompt: string;
  workFolder: string;
  model?: string;
  toolType: AgentType;
  startTime: string;
  stdout: string;
  stderr: string;
  status: ProcessStatus;
  exitCode?: number;
}

export interface ProcessListItem {
  pid: number;
  agent: AgentType;
  status: ProcessStatus;
}

export interface StartProcessResult {
  pid: number;
  status: 'started';
  agent: AgentType;
  message: string;
}

interface ProcessServiceOptions {
  cliPaths: BuildCliCommandOptions['cliPaths'];
}

function parseAgentOutput(agent: AgentType, stdout: string, stderr: string): any {
  if (agent === 'codex') {
    return parseCodexOutput(`${stdout || ''}\n${stderr || ''}`);
  }

  if (!stdout) {
    return null;
  }

  if (agent === 'claude') {
    return parseClaudeOutput(stdout);
  }
  if (agent === 'gemini') {
    return parseGeminiOutput(stdout);
  }
  if (agent === 'forge') {
    return parseForgeOutput(stdout);
  }
  if (agent === 'opencode') {
    return parseOpenCodeOutput(stdout);
  }

  return null;
}

export class ProcessService {
  private readonly processManager = new Map<number, TrackedProcess>();
  private readonly cliPaths: BuildCliCommandOptions['cliPaths'];

  constructor(options: ProcessServiceOptions) {
    this.cliPaths = options.cliPaths;
  }

  startProcess(options: Omit<BuildCliCommandOptions, 'cliPaths'>): StartProcessResult {
    const cmd = buildCliCommand({
      ...options,
      cliPaths: this.cliPaths,
    });

    const { cliPath, args: processArgs, cwd: effectiveCwd, agent, prompt } = cmd;
    const childProcess = spawn(cliPath, processArgs, {
      cwd: effectiveCwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    const pid = childProcess.pid;
    if (!pid) {
      throw new Error(`Failed to start ${agent} CLI process`);
    }

    const processEntry: TrackedProcess = {
      pid,
      process: childProcess,
      prompt,
      workFolder: effectiveCwd,
      model: options.model,
      toolType: agent,
      startTime: new Date().toISOString(),
      stdout: '',
      stderr: '',
      status: 'running',
    };

    this.processManager.set(pid, processEntry);

    childProcess.stdout.on('data', (data) => {
      const entry = this.processManager.get(pid);
      if (entry) {
        entry.stdout += data.toString();
      }
    });

    childProcess.stderr.on('data', (data) => {
      const entry = this.processManager.get(pid);
      if (entry) {
        entry.stderr += data.toString();
      }
    });

    childProcess.on('close', (code) => {
      const entry = this.processManager.get(pid);
      if (entry) {
        entry.status = code === 0 ? 'completed' : 'failed';
        entry.exitCode = code !== null ? code : undefined;
      }
    });

    childProcess.on('error', (error) => {
      const entry = this.processManager.get(pid);
      if (entry) {
        entry.status = 'failed';
        entry.stderr += `\nProcess error: ${error.message}`;
      }
    });

    return {
      pid,
      status: 'started',
      agent,
      message: `${agent} process started successfully`,
    };
  }

  listProcesses(): ProcessListItem[] {
    const processes: ProcessListItem[] = [];

    for (const [pid, process] of this.processManager.entries()) {
      processes.push({
        pid,
        agent: process.toolType,
        status: process.status,
      });
    }

    return processes;
  }

  getProcessResult(pid: number, verbose = false): any {
    const process = this.processManager.get(pid);
    if (!process) {
      throw new Error(`Process with PID ${pid} not found`);
    }

    const agentOutput = parseAgentOutput(process.toolType, process.stdout, process.stderr);

    return buildProcessResult({
      pid,
      agent: process.toolType,
      status: process.status,
      exitCode: process.exitCode,
      startTime: process.startTime,
      workFolder: process.workFolder,
      prompt: process.prompt,
      model: process.model,
      stdout: process.stdout,
      stderr: process.stderr,
    }, agentOutput, verbose);
  }

  async waitForProcesses(pids: number[], timeoutSeconds = 180, verbose = false): Promise<any[]> {
    for (const pid of pids) {
      if (!this.processManager.has(pid)) {
        throw new Error(`Process with PID ${pid} not found`);
      }
    }

    const waitPromises = pids.map((pid) => {
      const processEntry = this.processManager.get(pid)!;

      if (processEntry.status !== 'running') {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        processEntry.process.once('close', () => {
          resolve();
        });
      });
    });

    const timeoutMs = timeoutSeconds * 1000;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<void>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Timed out after ${timeoutSeconds} seconds waiting for processes`));
      }, timeoutMs);
      timeoutHandle.unref?.();
    });

    try {
      await Promise.race([Promise.all(waitPromises), timeoutPromise]);
      return pids.map((pid) => this.getProcessResult(pid, verbose));
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  killProcess(pid: number): { pid: number; status: string; message: string } {
    const processEntry = this.processManager.get(pid);
    if (!processEntry) {
      throw new Error(`Process with PID ${pid} not found`);
    }

    if (processEntry.status !== 'running') {
      return {
        pid,
        status: processEntry.status,
        message: 'Process already terminated',
      };
    }

    processEntry.process.kill('SIGTERM');
    processEntry.status = 'failed';
    processEntry.stderr += '\nProcess terminated by user';

    return {
      pid,
      status: 'terminated',
      message: 'Process terminated successfully',
    };
  }

  cleanupProcesses(): { removed: number; removedPids: number[]; message: string } {
    const removedPids: number[] = [];

    for (const [pid, process] of this.processManager.entries()) {
      if (process.status === 'completed' || process.status === 'failed') {
        removedPids.push(pid);
        this.processManager.delete(pid);
      }
    }

    return {
      removed: removedPids.length,
      removedPids,
      message: `Cleaned up ${removedPids.length} finished process(es)`,
    };
  }
}
