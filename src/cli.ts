#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { buildCliCommand } from './cli-builder.js';
import { findClaudeCli, findCodexCli, findForgeCli, findGeminiCli, findOpencodeCli, maybeQuoteWindowsArgs, quoteWindowsCmdArg } from './cli-utils.js';

/**
 * Minimal argv parser. No external dependencies.
 * Supports: --key value, --key=value
 */
function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;

    const eqIdx = arg.indexOf('=');
    if (eqIdx !== -1) {
      // --key=value
      result[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
    } else {
      // --key value
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = '';
      }
    }
  }
  return result;
}

const USAGE = `Usage: npm run -s cli.run -- --model <model> --workFolder <path> --prompt "..." [options]

Options:
  --model              Model name or alias (e.g. sonnet, opus, fable, gpt-5.6-sol, gemini-2.5-pro, forge, opencode, oc-openai/gpt-5.4)
  --workFolder         Working directory (absolute path)
  --prompt             Prompt string (mutually exclusive with --prompt_file)
  --prompt_file        Path to a file containing the prompt
  --session_id         Session ID to resume, including OpenCode in-place resumes
  --reasoning_effort   Claude/Codex only: Claude=low|medium|high|xhigh|max, Codex=low|medium|high|xhigh (GPT-5.6: max; Sol/Terra: ultra); unsupported for Gemini, Forge, and OpenCode
  --help               Show this help message

Raw CLI output goes to stdout. Use cli.run.parse to parse the output:
  npm run -s cli.run -- ... > raw.txt
  npm run -s cli.run.parse -- --agent claude < raw.txt
  npm run -s cli.run.parse -- --agent opencode < raw.txt
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if ('help' in args) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  if (!args.workFolder) {
    process.stderr.write('Error: --workFolder is required\n\n');
    process.stderr.write(USAGE);
    process.exit(1);
  }

  if (!args.prompt && !args.prompt_file) {
    process.stderr.write('Error: --prompt or --prompt_file is required\n\n');
    process.stderr.write(USAGE);
    process.exit(1);
  }

  // Resolve CLI paths
  const cliPaths = {
    claude: findClaudeCli(),
    codex: findCodexCli(),
    gemini: findGeminiCli(),
    forge: findForgeCli(),
    opencode: findOpencodeCli(),
  };

  // Build command
  let cmd;
  try {
    cmd = buildCliCommand({
      prompt: args.prompt || undefined,
      prompt_file: args.prompt_file || undefined,
      workFolder: args.workFolder,
      model: args.model || undefined,
      session_id: args.session_id || undefined,
      reasoning_effort: args.reasoning_effort || undefined,
      cliPaths,
    });
  } catch (error: any) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exit(1);
  }

  // Log agent info to stderr (does not pollute stdout)
  process.stderr.write(`[cli.run] agent=${cmd.agent} model=${cmd.resolvedModel || '(default)'}\n`);

  // Spawn foreground process — raw output passthrough
  const isWin = process.platform === 'win32';
  const child = spawn(
    isWin ? quoteWindowsCmdArg(cmd.cliPath) : cmd.cliPath,
    maybeQuoteWindowsArgs(cmd.args),
    {
      cwd: cmd.cwd,
      stdio: 'inherit',
      detached: false,
      shell: isWin,
    },
  );

  const exitCode = await new Promise<number>((resolve) => {
    child.on('close', (code) => {
      resolve(code ?? 1);
    });
    child.on('error', (err) => {
      process.stderr.write(`Process error: ${err.message}\n`);
      resolve(1);
    });
  });

  process.exit(exitCode);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});
