import { runMcpServer } from './mcp.js';
import { CliProcessService } from '../cli-process-service.js';
import { getCliDoctorStatus } from '../cli-utils.js';
import { getModelsPayload } from '../model-catalog.js';
import { validatePeekPids, validatePeekTimeSec } from '../peek.js';

export const CLI_HELP_TEXT = `Usage: ai-cli <command> [options]

Commands:
  run       Start an AI CLI process in the background
  wait      Wait for one or more pids
  peek      Observe new agent events for a short window
  ps        List tracked processes
  result    Get the current result for a pid
  kill      Terminate a tracked pid
  cleanup   Remove completed and failed tracked processes
  doctor    Check supported AI CLI binaries
  models    List supported models and aliases
  mcp       Start the MCP server
  help      Show this help message
`;

export const RUN_HELP_TEXT = `Usage: ai-cli run --cwd <path> [options]

Start an AI CLI process in the background.

Options:
  --cwd <path>                 Working directory
  --prompt <text>              Prompt text
  --prompt-file <path>         Path to a prompt file
  --model <model>              Model name or alias (e.g. sonnet, claude-ultra, gpt-5.6-sol, codex-ultra, gemini-2.5-pro, gemini-ultra, forge, opencode, oc-openai/gpt-5.4)
  --session-id <id>            Resume a previous session, including OpenCode in-place resumes
  --reasoning-effort <level>   Reasoning level for Claude/Codex only; unsupported for Gemini, Forge, and OpenCode
  --help, -h                   Show this help message

Compatibility aliases:
  --workFolder, --work-folder
  --prompt_file
  --session_id
  --reasoning_effort
`;

export const WAIT_HELP_TEXT = `Usage: ai-cli wait <pid...> [options]

Wait for one or more tracked processes to finish.
By default each result uses the compact shape; set --verbose to include full metadata and detailed parsed output.

Options:
  --timeout <seconds>          Maximum wait time in seconds
  --verbose                    Return full metadata and detailed parsed output
  --help, -h                   Show this help message
`;

export const RESULT_HELP_TEXT = `Usage: ai-cli result <pid> [options]

Get the current output and status of a tracked process. By default this returns a compact result shape; set --verbose to include full metadata and detailed parsed output.

Options:
  --verbose                    Return full metadata and detailed parsed output
  --help, -h                   Show this help message
`;

export const PEEK_HELP_TEXT = `Usage: ai-cli peek <pid...> [options]

Observe new natural-language agent messages, and optionally tool calls, for a short one-shot window.
In v1, message extraction is supported for Codex, Claude, OpenCode, Gemini, and best-effort Forge Summary/Completed successfully lines. Forge tool calls are low-precision Execute/Finished markers and never include command output.
This is not a history API, gapless streaming, or stdout/stderr tailing. No --follow mode is available in v1.

Options:
  --time <seconds>             Observation window in seconds. Defaults to 10, maximum 60
  --include-tool-calls         Include normalized tool_call events without raw tool output
  --help, -h                   Show this help message
`;

export const KILL_HELP_TEXT = `Usage: ai-cli kill <pid>

Terminate a tracked process.

Options:
  --help, -h                   Show this help message
`;

export const CLEANUP_HELP_TEXT = `Usage: ai-cli cleanup

Remove completed and failed tracked processes.

Options:
  --help, -h                   Show this help message
`;

export const PS_HELP_TEXT = `Usage: ai-cli ps

List tracked processes.

Options:
  --help, -h                   Show this help message
`;

export const MODELS_HELP_TEXT = `Usage: ai-cli models

List supported models and aliases.

Options:
  --help, -h                   Show this help message
`;

export const DOCTOR_HELP_TEXT = `Usage: ai-cli doctor

Check whether supported AI CLI binaries are available, including OpenCode.
This checks binary availability and path resolution only; it does not verify login state or terms acceptance.

Options:
  --help, -h                   Show this help message
`;

export const MCP_HELP_TEXT = `Usage: ai-cli mcp

Start the MCP server.
`;

interface CliDeps {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  startMcpServer: () => Promise<void>;
  runProcess: (options: {
    cwd: string;
    prompt?: string;
    prompt_file?: string;
    model?: string;
    session_id?: string;
    reasoning_effort?: string;
  }) => Promise<any>;
  listProcesses: () => Promise<any>;
  getProcessResult: (pid: number, verbose: boolean) => Promise<any>;
  waitForProcesses: (pids: number[], timeoutSeconds?: number, verbose?: boolean) => Promise<any>;
  peekProcesses: (pids: number[], peekTimeSec?: number, includeToolCalls?: boolean) => Promise<any>;
  killProcess: (pid: number) => Promise<any>;
  cleanupProcesses: () => Promise<any>;
  getDoctorStatus: () => any;
}

let cliProcessService: CliProcessService | null = null;

function getCliProcessService(): CliProcessService {
  if (!cliProcessService) {
    cliProcessService = new CliProcessService();
  }
  return cliProcessService;
}

const defaultDeps: CliDeps = {
  stdout: (text: string) => process.stdout.write(text),
  stderr: (text: string) => process.stderr.write(text),
  startMcpServer: () => runMcpServer(),
  runProcess: (options) => getCliProcessService().startProcess(options),
  listProcesses: () => getCliProcessService().listProcesses(),
  getProcessResult: (pid, verbose) => getCliProcessService().getProcessResult(pid, verbose),
  waitForProcesses: (pids, timeoutSeconds, verbose) => getCliProcessService().waitForProcesses(pids, timeoutSeconds, verbose),
  peekProcesses: (pids, peekTimeSec, includeToolCalls) => getCliProcessService().peekProcesses(pids, peekTimeSec, includeToolCalls),
  killProcess: (pid) => getCliProcessService().killProcess(pid),
  cleanupProcesses: () => getCliProcessService().cleanupProcesses(),
  getDoctorStatus: () => getCliDoctorStatus(),
};

function parseArgs(argv: string[]): { positionals: string[]; flags: Record<string, string> } {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h') {
      flags.h = '';
      continue;
    }

    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const eqIdx = arg.indexOf('=');
    if (eqIdx !== -1) {
      flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      continue;
    }

    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[arg.slice(2)] = next;
      i++;
    } else {
      flags[arg.slice(2)] = '';
    }
  }

  return { positionals, flags };
}

function getFirstFlag(flags: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    if (name in flags) {
      return flags[name];
    }
  }
  return undefined;
}

function parsePositivePid(value: string | undefined): number | null {
  const pid = Number(value);
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  return pid;
}

function writeJson(stdout: (text: string) => void, value: unknown): void {
  stdout(`${JSON.stringify(value, null, 2)}\n`);
}

function hasHelpFlag(flags: Record<string, string>): boolean {
  return 'help' in flags || 'h' in flags;
}

function parsePeekCliPids(values: string[]): number[] {
  return validatePeekPids(values.map((value) => Number(value)));
}

export async function runCli(argv: string[], deps: Partial<CliDeps> = {}): Promise<number> {
  const {
    stdout,
    stderr,
    startMcpServer,
    runProcess,
    listProcesses,
    getProcessResult,
    waitForProcesses,
    peekProcesses,
    killProcess,
    cleanupProcesses,
    getDoctorStatus,
  } = { ...defaultDeps, ...deps };
  const [command] = argv;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    stdout(CLI_HELP_TEXT);
    return 0;
  }

  if (command === 'mcp') {
    const { flags } = parseArgs(argv.slice(1));
    if (hasHelpFlag(flags)) {
      stdout(MCP_HELP_TEXT);
      return 0;
    }
    await startMcpServer();
    return 0;
  }

  if (command === 'run') {
    const { flags } = parseArgs(argv.slice(1));
    if (hasHelpFlag(flags)) {
      stdout(RUN_HELP_TEXT);
      return 0;
    }
    const cwd = getFirstFlag(flags, ['cwd', 'workFolder', 'work-folder']);
    if (!cwd) {
      stderr('Missing required option: --cwd\n');
      stdout(CLI_HELP_TEXT);
      return 1;
    }

    const prompt = getFirstFlag(flags, ['prompt']);
    const promptFile = getFirstFlag(flags, ['prompt-file', 'prompt_file']);
    if (!prompt && !promptFile) {
      stderr('Missing required option: --prompt or --prompt-file\n');
      stdout(CLI_HELP_TEXT);
      return 1;
    }

    const result = await runProcess({
      cwd,
      prompt: prompt || undefined,
      prompt_file: promptFile || undefined,
      model: getFirstFlag(flags, ['model']) || undefined,
      session_id: getFirstFlag(flags, ['session-id', 'session_id']) || undefined,
      reasoning_effort: getFirstFlag(flags, ['reasoning-effort', 'reasoning_effort']) || undefined,
    });
    writeJson(stdout, result);
    return 0;
  }

  if (command === 'ps') {
    const { flags } = parseArgs(argv.slice(1));
    if (hasHelpFlag(flags)) {
      stdout(PS_HELP_TEXT);
      return 0;
    }
    writeJson(stdout, await listProcesses());
    return 0;
  }

  if (command === 'result') {
    const { positionals, flags } = parseArgs(argv.slice(1));
    if (hasHelpFlag(flags)) {
      stdout(RESULT_HELP_TEXT);
      return 0;
    }
    const pid = parsePositivePid(positionals[0]);
    if (pid === null) {
      stderr('Missing required pid argument\n');
      stdout(CLI_HELP_TEXT);
      return 1;
    }
    writeJson(stdout, await getProcessResult(pid, 'verbose' in flags));
    return 0;
  }

  if (command === 'wait') {
    const { positionals, flags } = parseArgs(argv.slice(1));
    if (hasHelpFlag(flags)) {
      stdout(WAIT_HELP_TEXT);
      return 0;
    }
    const pids = positionals.map((value) => parsePositivePid(value));
    if (pids.length === 0) {
      stderr('Missing required pid arguments\n');
      stdout(CLI_HELP_TEXT);
      return 1;
    }
    if (pids.some((pid) => pid === null)) {
      stderr('All pid arguments must be positive integers\n');
      stdout(CLI_HELP_TEXT);
      return 1;
    }

    const timeoutRaw = getFirstFlag(flags, ['timeout']);
    const timeout = timeoutRaw ? Number(timeoutRaw) : undefined;
    if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
      stderr('Invalid --timeout value\n');
      stdout(CLI_HELP_TEXT);
      return 1;
    }

    writeJson(stdout, await waitForProcesses(pids as number[], timeout, 'verbose' in flags));
    return 0;
  }

  if (command === 'peek') {
    const { positionals, flags } = parseArgs(argv.slice(1));
    if (hasHelpFlag(flags)) {
      stdout(PEEK_HELP_TEXT);
      return 0;
    }
    if ('follow' in flags) {
      stderr('peek does not support --follow in v1\n');
      stdout(CLI_HELP_TEXT);
      return 1;
    }

    let pids: number[];
    let peekTimeSec: number;
    try {
      pids = parsePeekCliPids(positionals);
      const timeRaw = getFirstFlag(flags, ['time']);
      peekTimeSec = validatePeekTimeSec(timeRaw === undefined ? undefined : Number(timeRaw));
    } catch (error: any) {
      stderr(`${error.message}\n`);
      stdout(CLI_HELP_TEXT);
      return 1;
    }

    writeJson(stdout, await peekProcesses(pids, peekTimeSec, 'include-tool-calls' in flags || 'include_tool_calls' in flags));
    return 0;
  }

  if (command === 'kill') {
    const { positionals, flags } = parseArgs(argv.slice(1));
    if (hasHelpFlag(flags)) {
      stdout(KILL_HELP_TEXT);
      return 0;
    }
    const pid = parsePositivePid(positionals[0]);
    if (pid === null) {
      stderr('Missing required pid argument\n');
      stdout(CLI_HELP_TEXT);
      return 1;
    }
    writeJson(stdout, await killProcess(pid));
    return 0;
  }

  if (command === 'cleanup') {
    const { flags } = parseArgs(argv.slice(1));
    if (hasHelpFlag(flags)) {
      stdout(CLEANUP_HELP_TEXT);
      return 0;
    }
    writeJson(stdout, await cleanupProcesses());
    return 0;
  }

  if (command === 'models') {
    const { flags } = parseArgs(argv.slice(1));
    if (hasHelpFlag(flags)) {
      stdout(MODELS_HELP_TEXT);
      return 0;
    }
    writeJson(stdout, getModelsPayload());
    return 0;
  }

  if (command === 'doctor') {
    const { flags } = parseArgs(argv.slice(1));
    if (hasHelpFlag(flags)) {
      stdout(DOCTOR_HELP_TEXT);
      return 0;
    }
    writeJson(stdout, getDoctorStatus());
    return 0;
  }

  stderr(`Unknown subcommand: ${command}\n`);
  stdout(CLI_HELP_TEXT);
  return 1;
}
