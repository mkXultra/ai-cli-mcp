import { terminateProcessTree } from './process-termination.js';
import type { ChildProcess } from 'node:child_process';
import { buildCliCommand, type BuildCliCommandOptions } from './cli-builder.js';
import { parseGrokOutput, parseClaudeOutput, parseCodexOutput, parseForgeOutput, parseAntigravityOutput, parseOpenCodeOutput, parsePiOutput, PeekEventExtractor } from './parsers.js';
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
import { spawnCli } from './spawn-cli.js';

export type AgentType = 'claude' | 'codex' | 'gemini' | 'forge' | 'opencode' | 'grok' | 'pi';
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
  cancellationStarted?: boolean;
}

interface KillProcessResult {
  pid: number;
  status: string;
  message: string;
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

  if (agent === 'grok') {
    return parseGrokOutput(stdout);
  }
  if (agent === 'pi') {
    return parsePiOutput(stdout);
  }
  if (agent === 'claude') {
    return parseClaudeOutput(stdout);
  }
  if (agent === 'gemini') {
    return parseAntigravityOutput(stdout);
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
  // The root can close before detached descendants finish terminating.
  private readonly cancellations = new Map<number, Promise<KillProcessResult>>();
  private readonly cliPaths: BuildCliCommandOptions['cliPaths'];
  private shuttingDown = false;

  constructor(options: ProcessServiceOptions) {
    this.cliPaths = options.cliPaths;
  }

  startProcess(options: Omit<BuildCliCommandOptions, 'cliPaths'>): StartProcessResult {
    if (this.shuttingDown) throw new Error('Process service is shutting down');
    const cmd = buildCliCommand({
      ...options,
      cliPaths: this.cliPaths,
    });

    const { cliPath, args: processArgs, cwd: effectiveCwd, agent, prompt } = cmd;
    let childProcess: ChildProcess;
    try {
      childProcess = spawnCli(cliPath, processArgs, {
        cwd: effectiveCwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: (agent === 'grok' || agent === 'gemini' || agent === 'pi') && process.platform !== 'win32',
      });
    } catch {
      throw new Error(`Failed to start ${agent} CLI process`);
    }

    let processEntry: TrackedProcess | undefined;
    childProcess.on('error', (error) => {
      if (processEntry) {
        processEntry.status = 'failed';
        processEntry.stderr += `\nProcess error: ${error.message}`;
      }
    });

    const pid = childProcess.pid;
    if (!pid) {
      throw new Error(`Failed to start ${agent} CLI process`);
    }

    processEntry = {
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

    // Decode once at the pipe boundary; collection and peek share complete characters.
    childProcess.stdout?.setEncoding?.('utf8');
    childProcess.stderr?.setEncoding?.('utf8');
    childProcess.stdout?.on('data', (data) => {
      const entry = this.processManager.get(pid);
      if (entry) {
        entry.stdout += data.toString();
      }
    });

    childProcess.stderr?.on('data', (data) => {
      const entry = this.processManager.get(pid);
      if (entry) {
        entry.stderr += data.toString();
      }
    });

    childProcess.on('close', (code) => {
      const entry = this.processManager.get(pid);
      if (entry) {
        entry.status = !entry.cancellationStarted && code === 0 ? 'completed' : 'failed';
        entry.exitCode = entry.cancellationStarted ? 143 : code ?? entry.exitCode;
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

    const allFinished = Promise.all(waitPromises);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      if (timeoutSeconds === 0) {
        await allFinished;
      } else {
        const timeoutPromise = new Promise<void>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`Timed out after ${timeoutSeconds} seconds waiting for processes`));
          }, timeoutSeconds * 1000);
          timeoutHandle.unref?.();
        });
        await Promise.race([allFinished, timeoutPromise]);
      }
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

  async killProcess(pid: number): Promise<KillProcessResult> {
    const pending = this.cancellations.get(pid);
    if (pending) return pending;

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

    if (processEntry.toolType !== 'grok' && processEntry.toolType !== 'gemini' && processEntry.toolType !== 'pi') return this.terminateTrackedProcess(processEntry);

    // Register before signaling, and share the entire tree operation with other
    // kills and shutdown even after the root's public status becomes terminal.
    const cancellation = Promise.resolve().then(() => this.terminateTrackedProcess(processEntry));
    this.cancellations.set(pid, cancellation);
    try {
      return await cancellation;
    } finally {
      this.cancellations.delete(pid);
    }
  }

  private async terminateTrackedProcess(processEntry: TrackedProcess): Promise<KillProcessResult> {
    const { pid } = processEntry;
    let warning: string | undefined;
    if (processEntry.toolType === 'grok' || processEntry.toolType === 'gemini' || processEntry.toolType === 'pi') {
      const termination = await terminateProcessTree(pid, {
        ownedProcessGroup: process.platform !== 'win32',
        hasExited: () => processEntry.process.exitCode !== null || processEntry.process.signalCode !== null,
        // A rejected first signal must not turn later natural success into 143.
        // Successful signals notify synchronously, before close can be delivered.
        onSignalSent: () => { processEntry.cancellationStarted = true; },
      });
      warning = termination.warning;
      if (warning) processEntry.stderr += `\n${warning}`;
      if (!termination.terminated) return { pid, status: 'running', message: `Signal sent but process is still running${warning ? `. ${warning}` : ''}` };
      if (!processEntry.cancellationStarted) {
        return { pid, status: 'terminated', message: 'Process already terminated' };
      }
      processEntry.exitCode = 143;
    } else {
      processEntry.process.kill('SIGTERM');
    }
    processEntry.status = 'failed';
    processEntry.stderr += '\nProcess terminated by user';

    return {
      pid,
      status: 'terminated',
      message: `Process terminated successfully${warning ? `. ${warning}` : ''}`,
    };
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const pids = new Set([
      ...this.cancellations.keys(),
      ...[...this.processManager.values()].filter((entry) => entry.status === 'running').map((entry) => entry.pid),
    ]);
    const results = await Promise.allSettled([...pids].map((pid) => this.killProcess(pid)));
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
      if (result.value.status === 'running') throw new Error(result.value.message);
    }
  }

  cleanupProcesses(): { removed: number; removedPids: number[]; message: string } {
    const removedPids: number[] = [];

    for (const [pid, process] of this.processManager.entries()) {
      if (process.status !== 'running' && !this.cancellations.has(pid)) {
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
