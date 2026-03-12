import { runMcpServer } from './mcp.js';
import { CliProcessService } from '../cli-process-service.js';

export const CLI_HELP_TEXT = `Usage: ai-cli <command> [options]

Commands:
  run       Start an AI CLI process in the background
  wait      Wait for one or more pids
  ps        List tracked processes
  result    Get the current result for a pid
  kill      Terminate a tracked pid
  mcp       Start the MCP server
  help      Show this help message
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
  waitForProcesses: (pids: number[], timeoutSeconds?: number) => Promise<any>;
  killProcess: (pid: number) => Promise<any>;
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
  waitForProcesses: (pids, timeoutSeconds) => getCliProcessService().waitForProcesses(pids, timeoutSeconds),
  killProcess: (pid) => getCliProcessService().killProcess(pid),
};

function parseArgs(argv: string[]): { positionals: string[]; flags: Record<string, string> } {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
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

export async function runCli(argv: string[], deps: Partial<CliDeps> = {}): Promise<number> {
  const {
    stdout,
    stderr,
    startMcpServer,
    runProcess,
    listProcesses,
    getProcessResult,
    waitForProcesses,
    killProcess,
  } = { ...defaultDeps, ...deps };
  const [command] = argv;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    stdout(CLI_HELP_TEXT);
    return 0;
  }

  if (command === 'mcp') {
    await startMcpServer();
    return 0;
  }

  if (command === 'run') {
    const { flags } = parseArgs(argv.slice(1));
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
    writeJson(stdout, await listProcesses());
    return 0;
  }

  if (command === 'result') {
    const { positionals, flags } = parseArgs(argv.slice(1));
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

    writeJson(stdout, await waitForProcesses(pids as number[], timeout));
    return 0;
  }

  if (command === 'kill') {
    const { positionals } = parseArgs(argv.slice(1));
    const pid = parsePositivePid(positionals[0]);
    if (pid === null) {
      stderr('Missing required pid argument\n');
      stdout(CLI_HELP_TEXT);
      return 1;
    }
    writeJson(stdout, await killProcess(pid));
    return 0;
  }

  stderr(`Unknown subcommand: ${command}\n`);
  stdout(CLI_HELP_TEXT);
  return 1;
}
