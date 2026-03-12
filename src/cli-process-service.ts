import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { buildCliCommand, type BuildCliCommandOptions } from './cli-builder.js';
import { parseClaudeOutput, parseCodexOutput, parseGeminiOutput } from './parsers.js';
import { findClaudeCli, findCodexCli, findGeminiCli } from './cli-utils.js';
import type { AgentType, ProcessListItem } from './process-service.js';

interface StoredProcess {
  pid: number;
  prompt: string;
  workFolder: string;
  model?: string;
  toolType: AgentType;
  startTime: string;
  stdoutPath: string;
  stderrPath: string;
  status: 'running' | 'completed' | 'failed';
}

interface CliProcessServiceOptions {
  stateDir?: string;
  cliPaths?: BuildCliCommandOptions['cliPaths'];
}

export interface CliRunOptions {
  cwd: string;
  prompt?: string;
  prompt_file?: string;
  model?: string;
  session_id?: string;
  reasoning_effort?: string;
}

function resolveDefaultStateDir(): string {
  return process.env.AI_CLI_STATE_DIR || join(tmpdir(), 'ai-cli-mcp-state');
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    if (error.code === 'EPERM') {
      return true;
    }
    return false;
  }
}

export class CliProcessService {
  private readonly stateDir: string;
  private readonly cliPaths: BuildCliCommandOptions['cliPaths'];

  constructor(options: CliProcessServiceOptions = {}) {
    this.stateDir = options.stateDir || resolveDefaultStateDir();
    this.cliPaths = options.cliPaths || {
      claude: findClaudeCli(),
      codex: findCodexCli(),
      gemini: findGeminiCli(),
    };
    mkdirSync(this.stateDir, { recursive: true });
  }

  async startProcess(options: CliRunOptions): Promise<{ pid: number; status: 'started'; agent: AgentType; message: string }> {
    const cmd = buildCliCommand({
      prompt: options.prompt,
      prompt_file: options.prompt_file,
      workFolder: options.cwd,
      model: options.model,
      session_id: options.session_id,
      reasoning_effort: options.reasoning_effort,
      cliPaths: this.cliPaths,
    });

    const stdoutPath = this.resolveStdoutPathForPidPlaceholder();
    const stderrPath = this.resolveStderrPathForPidPlaceholder();
    let stdoutFd: number | undefined;
    let stderrFd: number | undefined;

    try {
      stdoutFd = openSync(stdoutPath, 'w');
      stderrFd = openSync(stderrPath, 'w');

      const childProcess = spawn(cmd.cliPath, cmd.args, {
        cwd: cmd.cwd,
        detached: true,
        stdio: ['ignore', stdoutFd, stderrFd],
      });

      const pid = childProcess.pid;
      childProcess.unref();

      if (!pid) {
        throw new Error(`Failed to start ${cmd.agent} CLI process`);
      }

      const finalStdoutPath = this.resolveStdoutPath(pid);
      const finalStderrPath = this.resolveStderrPath(pid);
      this.renamePlaceholderFile(stdoutPath, finalStdoutPath);
      this.renamePlaceholderFile(stderrPath, finalStderrPath);

      const storedProcess: StoredProcess = {
        pid,
        prompt: cmd.prompt,
        workFolder: cmd.cwd,
        model: options.model,
        toolType: cmd.agent,
        startTime: new Date().toISOString(),
        stdoutPath: finalStdoutPath,
        stderrPath: finalStderrPath,
        status: 'running',
      };
      this.writeProcess(storedProcess);

      return {
        pid,
        status: 'started',
        agent: cmd.agent,
        message: `${cmd.agent} process started successfully`,
      };
    } catch (error) {
      this.removeFileIfExists(stdoutPath);
      this.removeFileIfExists(stderrPath);
      throw error;
    } finally {
      if (stdoutFd !== undefined) {
        closeSync(stdoutFd);
      }
      if (stderrFd !== undefined) {
        closeSync(stderrFd);
      }
    }
  }

  async listProcesses(): Promise<ProcessListItem[]> {
    return this.readAllProcesses().map((process) => ({
      pid: process.pid,
      agent: process.toolType,
      status: this.refreshStatus(process).status,
    }));
  }

  async getProcessResult(pid: number, verbose = false): Promise<any> {
    const storedProcess = this.readProcess(pid);
    const refreshed = this.refreshStatus(storedProcess);
    const stdout = this.readTextFileSafe(refreshed.stdoutPath);
    const stderr = this.readTextFileSafe(refreshed.stderrPath);

    let agentOutput: any = null;
    if (refreshed.toolType === 'codex') {
      agentOutput = parseCodexOutput(`${stdout}\n${stderr}`);
    } else if (stdout) {
      if (refreshed.toolType === 'claude') {
        agentOutput = parseClaudeOutput(stdout);
      } else if (refreshed.toolType === 'gemini') {
        agentOutput = parseGeminiOutput(stdout);
      }
    }

    const response: any = {
      pid,
      agent: refreshed.toolType,
      status: refreshed.status,
      exitCode: undefined,
      startTime: refreshed.startTime,
      workFolder: refreshed.workFolder,
      prompt: refreshed.prompt,
      model: refreshed.model,
    };

    if (agentOutput) {
      if (!verbose && agentOutput.tools) {
        const { tools, ...rest } = agentOutput;
        response.agentOutput = rest;
      } else {
        response.agentOutput = agentOutput;
      }
      if (agentOutput.session_id) {
        response.session_id = agentOutput.session_id;
      }
    } else {
      response.stdout = stdout;
      response.stderr = stderr;
    }

    return response;
  }

  async waitForProcesses(pids: number[], timeoutSeconds = 180): Promise<any[]> {
    const start = Date.now();
    for (const pid of pids) {
      this.readProcess(pid);
    }

    while (true) {
      const statuses = pids.map((pid) => this.refreshStatus(this.readProcess(pid)).status);
      if (statuses.every((status) => status !== 'running')) {
        return Promise.all(pids.map((pid) => this.getProcessResult(pid, false)));
      }

      if (Date.now() - start >= timeoutSeconds * 1000) {
        throw new Error(`Timed out after ${timeoutSeconds} seconds waiting for processes`);
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async killProcess(pid: number): Promise<{ pid: number; status: string; message: string }> {
    const process = this.readProcess(pid);
    const refreshed = this.refreshStatus(process);

    if (refreshed.status !== 'running') {
      return {
        pid,
        status: refreshed.status,
        message: 'Process already terminated',
      };
    }

    this.killPidOrGroup(pid, 'SIGTERM');
    await this.waitForProcessExit(pid, 250);

    if (isProcessRunning(pid)) {
      return {
        pid,
        status: 'running',
        message: 'Signal sent but process is still running',
      };
    }

    refreshed.status = 'failed';
    this.writeProcess(refreshed);

    return {
      pid,
      status: 'terminated',
      message: 'Process terminated successfully',
    };
  }

  private readAllProcesses(): StoredProcess[] {
    if (!existsSync(this.stateDir)) {
      return [];
    }

    return readdirSync(this.stateDir)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => this.parseProcessFile(join(this.stateDir, entry)));
  }

  private readProcess(pid: number): StoredProcess {
    const metaPath = this.resolveMetaPath(pid);
    if (!existsSync(metaPath)) {
      throw new Error(`Process with PID ${pid} not found`);
    }
    return this.parseProcessFile(metaPath);
  }

  private parseProcessFile(metaPath: string): StoredProcess {
    return JSON.parse(readFileSync(metaPath, 'utf-8')) as StoredProcess;
  }

  private writeProcess(process: StoredProcess): void {
    writeFileSync(this.resolveMetaPath(process.pid), JSON.stringify(process, null, 2));
  }

  private refreshStatus(process: StoredProcess): StoredProcess {
    if (process.status === 'running' && !isProcessRunning(process.pid)) {
      process.status = 'completed';
      this.writeProcess(process);
    }
    return process;
  }

  private readTextFileSafe(filePath: string): string {
    if (!existsSync(filePath)) {
      return '';
    }
    return readFileSync(filePath, 'utf-8');
  }

  private resolveMetaPath(pid: number): string {
    return join(this.stateDir, `${pid}.json`);
  }

  private resolveStdoutPath(pid: number): string {
    return join(this.stateDir, `${pid}.stdout.log`);
  }

  private resolveStderrPath(pid: number): string {
    return join(this.stateDir, `${pid}.stderr.log`);
  }

  private resolveStdoutPathForPidPlaceholder(): string {
    return join(this.stateDir, `pending-${Date.now()}-${Math.random().toString(36).slice(2)}.stdout.log`);
  }

  private resolveStderrPathForPidPlaceholder(): string {
    return join(this.stateDir, `pending-${Date.now()}-${Math.random().toString(36).slice(2)}.stderr.log`);
  }

  private renamePlaceholderFile(fromPath: string, toPath: string): void {
    renameSync(fromPath, toPath);
  }

  private removeFileIfExists(filePath: string): void {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }

  private killPidOrGroup(pid: number, signal: NodeJS.Signals): void {
    try {
      globalThis.process.kill(-pid, signal);
    } catch (error: any) {
      if (error.code === 'ESRCH' || error.code === 'EINVAL') {
        globalThis.process.kill(pid, signal);
        return;
      }
      if (error.code === 'EPERM') {
        throw error;
      }
      globalThis.process.kill(pid, signal);
    }
  }

  private async waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    while (isProcessRunning(pid) && Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}
