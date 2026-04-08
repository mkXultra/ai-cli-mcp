#!/usr/bin/env node
import { parseClaudeOutput, parseCodexOutput, parseForgeOutput, parseGeminiOutput, parseOpenCodeOutput } from './parsers.js';

const AGENTS = ['claude', 'codex', 'gemini', 'forge', 'opencode'] as const;
type Agent = typeof AGENTS[number];

const USAGE = `Usage: npm run -s cli.run.parse -- --agent <claude|codex|gemini|forge|opencode>

Reads raw CLI output from stdin and outputs parsed JSON to stdout.

Options:
  --agent   Agent type: claude, codex, gemini, forge, or opencode (required)
  --help    Show this help message

Examples:
  npm run -s cli.run -- --model sonnet --workFolder /tmp --prompt "hi" > raw.txt
  npm run -s cli.run.parse -- --agent claude < raw.txt

  npm run -s cli.run -- --model opencode --workFolder /tmp --prompt "hi" > raw.txt
  npm run -s cli.run.parse -- --agent opencode < raw.txt

  # Or pipe directly
  npm run -s cli.run -- --model sonnet --workFolder /tmp --prompt "hi" | npm run -s cli.run.parse -- --agent claude
`;

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;

    const eqIdx = arg.indexOf('=');
    if (eqIdx !== -1) {
      result[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
    } else {
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

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', reject);
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if ('help' in args) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const agent = args.agent as Agent;
  if (!agent || !AGENTS.includes(agent)) {
    process.stderr.write(`Error: --agent is required (claude, codex, gemini, forge, or opencode)\n\n`);
    process.stderr.write(USAGE);
    process.exit(1);
  }

  const input = await readStdin();

  if (!input.trim()) {
    process.stderr.write('Error: no input received from stdin\n');
    process.exit(1);
  }

  let parsed: any = null;
  switch (agent) {
    case 'claude':
      parsed = parseClaudeOutput(input);
      break;
    case 'codex':
      parsed = parseCodexOutput(input);
      break;
    case 'gemini':
      parsed = parseGeminiOutput(input);
      break;
    case 'forge':
      parsed = parseForgeOutput(input);
      break;
    case 'opencode':
      parsed = parseOpenCodeOutput(input);
      break;
  }

  process.stdout.write(JSON.stringify(parsed, null, 2) + '\n');
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});
