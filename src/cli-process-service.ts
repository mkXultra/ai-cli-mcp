import { spawn } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { buildCliCommand, type BuildCliCommandOptions } from './cli-builder.js';
import { findClaudeCli, findCodexCli, findForgeCli, findGeminiCli, findOpencodeCli } from './cli-utils.js';
import { parseClaudeOutput, parseCodexOutput, parseForgeOutput, parseGeminiOutput, parseOpenCodeOutput, PeekEventExtractor } from './parsers.js';
import { buildProcessResult } from './process-result.js';
import {
  appendPeekEvents,
  buildNotFoundPeekProcess,
  observedDurationSec,
  validatePeekPids,
  validatePeekTimeSec,
  type PeekProcessResult,
  type PeekResponse,
} from './peek.js';
import type { AgentType, ProcessListItem } from './process-service.js';

interface StoredProcess {
  pid: number;
  prompt: string;
  workFolder: string;
  cwdKey?: string;
  model?: string;
  toolType: AgentType;
  startTime: string;
  stdoutPath: string;
  stderrPath: string;
  status: 'running' | 'completed' | 'failed';
  exitCode?: number;
}

interface StoredExitStatus {
  status: 'completed' | 'failed';
  exitCode?: number;
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
  return process.env.AI_CLI_STATE_DIR || join(homedir(), '.local', 'state', 'ai-cli');
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

function normalizeCwdForStorage(cwd: string): string {
  return cwd
    .split('')
    .map((char) => (/^[A-Za-z0-9.-]$/.test(char) ? char : `_${char.charCodeAt(0).toString(16).padStart(2, '0')}`))
    .join('');
}

function parseAgentOutput(agent: AgentType, stdout: string, stderr: string): any {
  if (agent === 'codex') {
    return parseCodexOutput(`${stdout}\n${stderr}`);
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

export class CliProcessService {
  private readonly stateDir: string;
  private readonly cliPaths: BuildCliCommandOptions['cliPaths'];

  constructor(options: CliProcessServiceOptions = {}) {
    this.stateDir = options.stateDir || resolveDefaultStateDir();
    this.cliPaths = options.cliPaths || {
      claude: findClaudeCli(),
      codex: findCodexCli(),
      gemini: findGeminiCli(),
      forge: findForgeCli(),
      opencode: findOpencodeCli(),
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

    return this.startDetachedTrackedProcess(cmd, options.model);
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
    const agentOutput = parseAgentOutput(refreshed.toolType, stdout, stderr);

    return buildProcessResult({
      pid,
      agent: refreshed.toolType,
      status: refreshed.status,
      exitCode: refreshed.exitCode,
      startTime: refreshed.startTime,
      workFolder: refreshed.workFolder,
      prompt: refreshed.prompt,
      model: refreshed.model,
      stdout,
      stderr,
    }, agentOutput, verbose);
  }

  async waitForProcesses(pids: number[], timeoutSeconds = 180, verbose = false): Promise<any[]> {
    const start = Date.now();
    for (const pid of pids) {
      this.readProcess(pid);
    }

    while (true) {
      const statuses = pids.map((pid) => this.refreshStatus(this.readProcess(pid)).status);
      if (statuses.every((status) => status !== 'running')) {
        return Promise.all(pids.map((pid) => this.getProcessResult(pid, verbose)));
      }

      if (Date.now() - start >= timeoutSeconds * 1000) {
        throw new Error(`Timed out after ${timeoutSeconds} seconds waiting for processes`);
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async peekProcesses(pids: number[], peekTimeSec = 10, includeToolCalls = false): Promise<PeekResponse> {
    const targetPids = validatePeekPids(pids);
    const targetPeekTimeSec = validatePeekTimeSec(peekTimeSec);
    const processes: PeekProcessResult[] = [];
    const observers: Array<{
      process: StoredProcess;
      result: PeekProcessResult;
      stdoutExtractor: PeekEventExtractor;
      stderrExtractor: PeekEventExtractor;
      stdoutOffset: number;
      stderrOffset: number;
    }> = [];

    for (const pid of targetPids) {
      let process: StoredProcess;
      try {
        process = this.refreshStatus(this.readProcess(pid));
      } catch {
        processes.push(buildNotFoundPeekProcess(pid));
        continue;
      }

      const result: PeekProcessResult = {
        pid,
        agent: process.toolType,
        status: process.status,
        events: [],
        truncated: false,
        error: null,
      };
      processes.push(result);
      observers.push({
        process,
        result,
        stdoutExtractor: new PeekEventExtractor(process.toolType, { includeToolCalls, source: 'stdout' }),
        stderrExtractor: new PeekEventExtractor(process.toolType, { includeToolCalls, source: 'stderr' }),
        stdoutOffset: this.fileSizeSafe(process.stdoutPath),
        stderrOffset: this.fileSizeSafe(process.stderrPath),
      });
    }

    const startedAt = new Date();
    const startedAtMs = Date.now();
    const deadlineMs = startedAtMs + targetPeekTimeSec * 1000;

    while (Date.now() <= deadlineMs) {
      const observedAt = new Date().toISOString();
      let allTerminal = true;

      for (const observer of observers) {
        const stdoutRead = this.readTextFromOffset(observer.process.stdoutPath, observer.stdoutOffset);
        observer.stdoutOffset = stdoutRead.offset;
        appendPeekEvents(observer.result, observer.stdoutExtractor.push(stdoutRead.text, observedAt));

        const stderrRead = this.readTextFromOffset(observer.process.stderrPath, observer.stderrOffset);
        observer.stderrOffset = stderrRead.offset;
        appendPeekEvents(observer.result, observer.stderrExtractor.push(stderrRead.text, observedAt));

        observer.process = this.refreshStatus(this.readProcess(observer.process.pid));
        observer.result.status = observer.process.status;
        if (observer.process.status === 'running') {
          allTerminal = false;
        }
      }

      if (allTerminal) {
        break;
      }

      const remainingMs = deadlineMs - Date.now();
      if (remainingMs <= 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(50, remainingMs)));
    }

    const flushTs = new Date().toISOString();
    for (const observer of observers) {
      observer.process = this.refreshStatus(this.readProcess(observer.process.pid));
      observer.result.status = observer.process.status;
      const terminal = observer.process.status !== 'running';
      appendPeekEvents(observer.result, observer.stdoutExtractor.flush(flushTs, { terminal }));
      appendPeekEvents(observer.result, observer.stderrExtractor.flush(flushTs, { terminal }));
    }

    return {
      peek_started_at: startedAt.toISOString(),
      observed_duration_sec: observedDurationSec(startedAtMs),
      processes,
    };
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

  async cleanupProcesses(): Promise<{ removed: number; message: string }> {
    let removed = 0;

    for (const process of this.readAllProcesses()) {
      const refreshed = this.refreshStatus(process);
      if (refreshed.status === 'running') {
        continue;
      }

      const processDir = this.resolveStoredProcessDir(refreshed);
      if (existsSync(processDir)) {
        rmSync(processDir, { recursive: true, force: true });
        removed++;
      }
    }

    this.removeEmptyCwdDirs();

    return {
      removed,
      message: `Removed ${removed} processes`,
    };
  }

  private async startDetachedTrackedProcess(
    cmd: Awaited<ReturnType<typeof buildCliCommand>>,
    model: string | undefined,
  ): Promise<{ pid: number; status: 'started'; agent: AgentType; message: string }> {
    const cwdKey = this.resolveCwdKey(cmd.cwd);
    const wrapperPath = this.ensureDetachedWrapperScript();

    const childProcess = spawn(wrapperPath, [this.stateDir, cwdKey, cmd.cliPath, ...cmd.args], {
      cwd: cmd.cwd,
      detached: true,
      stdio: 'ignore',
    });

    const pid = childProcess.pid;
    childProcess.unref();

    if (!pid) {
      throw new Error(`Failed to start ${cmd.agent} CLI process`);
    }

    const processDir = this.resolveProcessDir(cmd.cwd, pid);
    mkdirSync(processDir, { recursive: true });
    const stdoutPath = this.resolveStdoutPath(processDir);
    const stderrPath = this.resolveStderrPath(processDir);
    this.touchFile(stdoutPath);
    this.touchFile(stderrPath);

    const storedProcess: StoredProcess = {
      pid,
      prompt: cmd.prompt,
      workFolder: cmd.cwd,
      cwdKey,
      model,
      toolType: cmd.agent,
      startTime: new Date().toISOString(),
      stdoutPath,
      stderrPath,
      status: 'running',
    };
    this.writeProcess(storedProcess);

    return {
      pid,
      status: 'started',
      agent: cmd.agent,
      message: `${cmd.agent} process started successfully`,
    };
  }

  private readAllProcesses(): StoredProcess[] {
    const cwdsDir = this.resolveCwdsDir();
    if (!existsSync(cwdsDir)) {
      return [];
    }

    const processes: StoredProcess[] = [];
    for (const cwdEntry of readdirSync(cwdsDir)) {
      const cwdDir = join(cwdsDir, cwdEntry);
      for (const pidEntry of readdirSync(cwdDir)) {
        const metaPath = join(cwdDir, pidEntry, 'meta.json');
        if (existsSync(metaPath)) {
          processes.push(this.parseProcessFile(metaPath));
        }
      }
    }

    return processes;
  }

  private readProcess(pid: number): StoredProcess {
    const process = this.readAllProcesses().find((entry) => entry.pid === pid);
    if (!process) {
      throw new Error(`Process with PID ${pid} not found`);
    }
    return process;
  }

  private parseProcessFile(metaPath: string): StoredProcess {
    const process = JSON.parse(readFileSync(metaPath, 'utf-8')) as StoredProcess;
    if (!process.cwdKey) {
      process.cwdKey = basename(dirname(dirname(metaPath)));
    }
    return process;
  }

  private writeProcess(process: StoredProcess): void {
    const processDir = this.resolveStoredProcessDir(process);
    mkdirSync(processDir, { recursive: true });
    writeFileSync(this.resolveMetaPath(processDir), JSON.stringify(process, null, 2));
  }

  private refreshStatus(process: StoredProcess): StoredProcess {
    if (process.status !== 'running') {
      return process;
    }

    const persistedExitStatus = this.readExitStatus(process);
    if (persistedExitStatus) {
      process.status = persistedExitStatus.status;
      process.exitCode = persistedExitStatus.exitCode;
      this.writeProcess(process);
      return process;
    }

    if (!isProcessRunning(process.pid)) {
      process.status = 'completed';
      this.writeProcess(process);
    }
    return process;
  }

  private readExitStatus(process: StoredProcess): StoredExitStatus | null {
    const exitMetaPath = this.resolveExitStatusPath(this.resolveStoredProcessDir(process));
    if (!existsSync(exitMetaPath)) {
      return null;
    }

    try {
      const parsed = JSON.parse(readFileSync(exitMetaPath, 'utf-8')) as StoredExitStatus;
      if (parsed.status === 'completed' || parsed.status === 'failed') {
        return parsed;
      }
    } catch {
      return null;
    }

    return null;
  }

  private readTextFileSafe(filePath: string): string {
    if (!existsSync(filePath)) {
      return '';
    }
    return readFileSync(filePath, 'utf-8');
  }

  private touchFile(filePath: string): void {
    closeSync(openSync(filePath, 'a'));
  }

  private fileSizeSafe(filePath: string): number {
    if (!existsSync(filePath)) {
      return 0;
    }
    return statSync(filePath).size;
  }

  private readTextFromOffset(filePath: string, offset: number): { text: string; offset: number } {
    if (!existsSync(filePath)) {
      return { text: '', offset };
    }

    const size = statSync(filePath).size;
    if (size <= offset) {
      return { text: '', offset: size };
    }

    const fd = openSync(filePath, 'r');
    try {
      const length = size - offset;
      const buffer = Buffer.alloc(length);
      const bytesRead = readSync(fd, buffer, 0, length, offset);
      return {
        text: buffer.subarray(0, bytesRead).toString('utf-8'),
        offset: size,
      };
    } finally {
      closeSync(fd);
    }
  }

  private resolveCwdsDir(): string {
    return join(this.stateDir, 'cwds');
  }

  private resolveProcessDir(cwd: string, pid: number): string {
    return join(this.resolveCwdsDir(), this.resolveCwdKey(cwd), String(pid));
  }

  private resolveStoredProcessDir(process: StoredProcess): string {
    if (!process.cwdKey) {
      process.cwdKey = this.resolveCwdKey(process.workFolder);
    }
    return join(this.resolveCwdsDir(), process.cwdKey, String(process.pid));
  }

  private resolveCwdKey(cwd: string): string {
    return normalizeCwdForStorage(realpathSync(cwd));
  }

  private resolveMetaPath(processDir: string): string {
    return join(processDir, 'meta.json');
  }

  private resolveStdoutPath(processDir: string): string {
    return join(processDir, 'stdout.log');
  }

  private resolveStderrPath(processDir: string): string {
    return join(processDir, 'stderr.log');
  }

  private resolveExitStatusPath(processDir: string): string {
    return join(processDir, 'exit-status.json');
  }

  private resolveDetachedWrapperPath(): string {
    return join(this.stateDir, 'detached-runner-v1.sh');
  }

  private ensureDetachedWrapperScript(): string {
    const wrapperPath = this.resolveDetachedWrapperPath();
    if (existsSync(wrapperPath)) {
      return wrapperPath;
    }

    writeFileSync(
      wrapperPath,
      `#!/bin/sh
set +e
state_dir="$1"
cwd_key="$2"
shift 2
pid="$$"
process_dir="$state_dir/cwds/$cwd_key/$pid"
stdout_path="$process_dir/stdout.log"
stderr_path="$process_dir/stderr.log"
exit_meta_path="$process_dir/exit-status.json"
mkdir -p "$process_dir"
: > "$stdout_path"
: > "$stderr_path"
"$@" >> "$stdout_path" 2>> "$stderr_path"
exit_code="$?"
status="completed"
if [ "$exit_code" -ne 0 ]; then
  status="failed"
fi
printf '{\n  "status": "%s",\n  "exitCode": %s\n}\n' "$status" "$exit_code" > "$exit_meta_path"
exit "$exit_code"
`,
    );
    chmodSync(wrapperPath, 0o755);
    return wrapperPath;
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

  private removeEmptyCwdDirs(): void {
    const cwdsDir = this.resolveCwdsDir();
    if (!existsSync(cwdsDir)) {
      return;
    }

    for (const cwdEntry of readdirSync(cwdsDir)) {
      const cwdDir = join(cwdsDir, cwdEntry);
      if (readdirSync(cwdDir).length === 0) {
        rmSync(cwdDir, { recursive: true, force: true });
      }
    }
  }
}
