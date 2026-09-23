import { runMcpServer } from './mcp.js';
import { addUserAlias, listAliases, removeUserAlias } from './aliases.js';
import { CliProcessService } from '../cli-process-service.js';
import { getCliDoctorStatus } from '../cli-utils.js';
import { getDiscoveredModelsPayload } from '../model-discovery.js';
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
  alias     List, add, update, or remove model aliases
  mcp       Start the MCP server
  help      Show this help message

User model aliases: ~/.config/ai-cli/config.json
Set AI_CLI_CONFIG_PATH to use a different config file.
`;

export const RUN_HELP_TEXT = `Usage: ai-cli run --cwd <path> [options]

Start an AI CLI process in the background. Use --model grok or --model pi for that CLI's configured default. Use pi-<provider/model> for an explicit Pi model. A user alias named grok keeps precedence. Use --prompt=TEXT / --session-id=ID for values beginning with --.

Options:
  --cwd <path>                 Working directory
  --prompt <text>              Prompt text
  --prompt-file <path>         Path to a prompt file
  --model <model>              Model name or alias (e.g. sonnet, fable, claude-ultra, gpt-6-astra, codex-ultra, gemini-3.1-pro-high, gemini-ultra, grok-4.6, opencode, oc-openai/gpt-5.4, pi, pi-openai-codex/gpt-6-astra)
  --session-id <id>            Resume a previous session, including Grok, OpenCode, and Pi in-place resumes
  --reasoning-effort <level>   Reasoning level for Claude/Codex/Grok/Pi; Pi=off|minimal|low|medium|high|xhigh|max; unsupported for OpenCode
  --help, -h                   Show this help message

Grok: grok-4.6=low/medium/high/xhigh; grok-4.5, grok (configured default), and other grok-* models=low/medium/high. Omitted effort uses the CLI default. Grok never accepts max/ultra.

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
  --timeout <seconds>          Maximum wait time in seconds (default: 180; 0: no timeout)
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
Message extraction is supported for Codex, Claude, Grok (whole assistant messages), OpenCode, Gemini, and Pi text deltas.
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

List supported models and aliases, including live Pi and OpenCode model lists.
Discovery runs in parallel with a 5-second timeout per CLI. Backend failures are included in the JSON result.

Includes user aliases from ~/.config/ai-cli/config.json (or AI_CLI_CONFIG_PATH).

Options:
  --help, -h                   Show this help message
`;

export const ALIAS_HELP_TEXT = `Usage:
  ai-cli alias list
  ai-cli alias add <name> <model> [--effort <level>]
  ai-cli alias rm <name>

Manage aliases in ~/.config/ai-cli/config.json (or AI_CLI_CONFIG_PATH).
list prints JSON with the config path and effective built-in/user aliases without writing files.
add creates the file if needed and replaces any existing definition of the name.
Omitting --effort uses the target CLI's default reasoning effort.
rm removes a user definition; removing a built-in override restores its default.
Use ai-cli models to list aliases together with supported models.

Options:
  --effort <level>      Default reasoning effort for this alias (Claude/Codex/Grok/Pi)
  --help, -h            Show this help message

Compatibility aliases: --reasoning-effort, --reasoning_effort
`;

export const DOCTOR_HELP_TEXT = `Usage: ai-cli doctor

Check whether supported AI CLI binaries are available, including OpenCode, Grok (GROK_CLI_NAME), and Pi (PI_CLI_NAME).
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
  getModels: typeof getDiscoveredModelsPayload;
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
  getModels: getDiscoveredModelsPayload,
};

function parseArgs(argv: string[]): { positionals: string[]; flags: Record<string, string> } {
  const positionals: string[] = [];
  const flags: Record<string, string> = Object.create(null);

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
    getModels,
  } = { ...defaultDeps, ...deps };
  const [command] = argv;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    stdout(CLI_HELP_TEXT);
    return 0;
  }

  if (command === 'alias') {
    const args = argv.slice(1);
    if (!args.length || args.includes('--help') || args.includes('-h')) {
      stdout(ALIAS_HELP_TEXT);
      return 0;
    }
    const { positionals, flags } = parseArgs(args);
    const [action, name, model] = positionals;
    const fail = (message: string): number => {
      stderr(`${message}\n`);
      stdout(ALIAS_HELP_TEXT);
      return 1;
    };
    if (action !== 'list' && action !== 'add' && action !== 'rm') {
      return fail('Expected alias subcommand: list, add or rm');
    }
    const effortFlags = ['effort', 'reasoning-effort', 'reasoning_effort'];
    const unknownFlag = Object.keys(flags).find((flag) => !effortFlags.includes(flag));
    if (unknownFlag !== undefined) return fail(`Unknown alias option: --${unknownFlag}`);
    if (action === 'list') {
      if (positionals.length !== 1 || Object.keys(flags).length) {
        return fail('Usage: ai-cli alias list (no name, model or effort options)');
      }
      writeJson(stdout, listAliases());
      return 0;
    }
    if (action === 'rm') {
      if (positionals.length !== 2 || Object.keys(flags).length) {
        return fail('Usage: ai-cli alias rm <name> (no model or effort options)');
      }
      writeJson(stdout, removeUserAlias(name));
      return 0;
    }
    if (positionals.length !== 3) {
      return fail('Usage: ai-cli alias add <name> <model> [--effort <level>]');
    }
    if (args.filter((arg) => /^--(?:effort|reasoning-effort|reasoning_effort)(?:=|$)/.test(arg)).length > 1) {
      return fail('Specify the alias effort only once.');
    }
    const effort = getFirstFlag(flags, effortFlags);
    if (effort !== undefined && !effort.trim()) {
      return fail('Missing value for alias effort.');
    }
    writeJson(stdout, addUserAlias(name, model, effort));
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
    const timeout = timeoutRaw === undefined ? undefined : Number(timeoutRaw);
    if (timeout !== undefined && (timeoutRaw?.trim() === '' || !Number.isFinite(timeout) || timeout < 0)) {
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
    writeJson(stdout, await getModels());
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
