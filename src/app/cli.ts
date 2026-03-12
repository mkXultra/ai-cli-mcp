import { runMcpServer } from './mcp.js';

export const CLI_HELP_TEXT = `Usage: ai-cli <command> [options]

Commands:
  mcp       Start the MCP server
  help      Show this help message
`;

interface CliDeps {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  startMcpServer: () => Promise<void>;
}

const defaultDeps: CliDeps = {
  stdout: (text: string) => process.stdout.write(text),
  stderr: (text: string) => process.stderr.write(text),
  startMcpServer: () => runMcpServer(),
};

export async function runCli(argv: string[], deps: Partial<CliDeps> = {}): Promise<number> {
  const { stdout, stderr, startMcpServer } = { ...defaultDeps, ...deps };
  const [command] = argv;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    stdout(CLI_HELP_TEXT);
    return 0;
  }

  if (command === 'mcp') {
    await startMcpServer();
    return 0;
  }

  stderr(`Unknown subcommand: ${command}\n`);
  stdout(CLI_HELP_TEXT);
  return 1;
}
