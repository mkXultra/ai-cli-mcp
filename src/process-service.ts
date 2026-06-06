import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCliCommand, type BuildCliCommandOptions } from './cli-builder.js';
import { parseClaudeOutput, parseCodexOutput, parseForgeOutput, parseGeminiOutput, parseOpenCodeOutput, PeekEventExtractor } from './parsers.js';
import {
  appendPeekEvents,
  buildNotFoundPeekProcess,
  observedDurationSec,
  validatePeekPids,
  validatePeekTimeSec,
  type PeekProcessResult,
  type PeekResponse,
} from './peek.js';
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
  logPath?: string;
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

function parseAgentOutput(agent: AgentType, stdout: string, stderr: string, logText = ''): any {
  if (agent === 'codex') {
    return parseCodexOutput(`${stdout || ''}\n${stderr || ''}`);
  }

  if (agent === 'gemini') {
    return parseGeminiOutput(stdout, logText);
  }

  if (!stdout) {
    return null;
  }

  if (agent === 'claude') {
    return parseClaudeOutput(stdout);
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
    let cmd = buildCliCommand({
      ...options,
      cliPaths: this.cliPaths,
    });

    let logPath: string | undefined;
    if (cmd.agent === 'gemini') {
      logPath = this.createAgyLogPath();
      cmd = buildCliCommand({
        ...options,
        log_file: logPath,
        cliPaths: this.cliPaths,
      });
    }

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
      logPath,
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

    const logText = process.logPath ? this.readTextFileSafe(process.logPath) : '';
    const agentOutput = parseAgentOutput(process.toolType, process.stdout, process.stderr, logText);

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

  async peekProcesses(pids: number[], peekTimeSec = 10, includeToolCalls = false): Promise<PeekResponse> {
    const targetPids = validatePeekPids(pids);
    const targetPeekTimeSec = validatePeekTimeSec(peekTimeSec);
    const processes: PeekProcessResult[] = [];
    const observers: Array<{
      entry: TrackedProcess;
      result: PeekProcessResult;
      stdoutExtractor: PeekEventExtractor;
      stderrExtractor: PeekEventExtractor;
      onStdout: (data: Buffer | string) => void;
      onStderr: (data: Buffer | string) => void;
    }> = [];

    for (const pid of targetPids) {
      const entry = this.processManager.get(pid);
      if (!entry) {
        processes.push(buildNotFoundPeekProcess(pid));
        continue;
      }

      const result: PeekProcessResult = {
        pid,
        agent: entry.toolType,
        status: entry.status,
        events: [],
        truncated: false,
        error: null,
      };
      processes.push(result);

      const stdoutExtractor = new PeekEventExtractor(entry.toolType, { includeToolCalls, source: 'stdout' });
      const stderrExtractor = new PeekEventExtractor(entry.toolType, { includeToolCalls, source: 'stderr' });
      const onStdout = (data: Buffer | string) => {
        appendPeekEvents(result, stdoutExtractor.push(data.toString(), new Date().toISOString()));
      };
      const onStderr = (data: Buffer | string) => {
        appendPeekEvents(result, stderrExtractor.push(data.toString(), new Date().toISOString()));
      };

      if (entry.status === 'running') {
        entry.process.stdout?.on('data', onStdout);
        entry.process.stderr?.on('data', onStderr);
      }

      observers.push({ entry, result, stdoutExtractor, stderrExtractor, onStdout, onStderr });
    }

    const startedAt = new Date();
    const startedAtMs = Date.now();
    const runningObservers = observers.filter((observer) => observer.entry.status === 'running');
    const terminalPromise = Promise.all(runningObservers.map((observer) => this.waitForProcessTerminal(observer.entry)));
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutHandle = setTimeout(resolve, targetPeekTimeSec * 1000);
      timeoutHandle.unref?.();
    });

    try {
      await Promise.race([terminalPromise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      const flushTs = new Date().toISOString();
      for (const observer of observers) {
        observer.entry.process.stdout?.off('data', observer.onStdout);
        observer.entry.process.stderr?.off('data', observer.onStderr);
        const terminal = observer.entry.status !== 'running';
        appendPeekEvents(observer.result, observer.stdoutExtractor.flush(flushTs, { terminal }));
        appendPeekEvents(observer.result, observer.stderrExtractor.flush(flushTs, { terminal }));
        observer.result.status = observer.entry.status;
      }
    }

    return {
      peek_started_at: startedAt.toISOString(),
      observed_duration_sec: observedDurationSec(startedAtMs),
      processes,
    };
  }

  private waitForProcessTerminal(processEntry: TrackedProcess): Promise<void> {
    if (processEntry.status !== 'running') {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      const done = () => {
        processEntry.process.off('close', done);
        processEntry.process.off('error', done);
        resolve();
      };
      processEntry.process.once('close', done);
      processEntry.process.once('error', done);
    });
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
        if (process.logPath) {
          this.removeAgyLogPath(process.logPath);
        }
        this.processManager.delete(pid);
      }
    }

    return {
      removed: removedPids.length,
      removedPids,
      message: `Cleaned up ${removedPids.length} finished process(es)`,
    };
  }

  private createAgyLogPath(): string {
    return join(tmpdir() || '.', `ai-cli-mcp-agy-${randomUUID()}.log`);
  }

  private readTextFileSafe(filePath: string): string {
    if (!existsSync(filePath)) {
      return '';
    }

    try {
      const text = readFileSync(filePath, 'utf-8');
      return typeof text === 'string' ? text : '';
    } catch {
      return '';
    }
  }

  private removeAgyLogPath(filePath: string): void {
    try {
      rmSync(filePath, { force: true });
    } catch {
    }
  }
}
