import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

export function getClaudeMockPath(binaryName: string = 'claude'): string {
  const fileName = process.platform === 'win32' ? `${binaryName}.cmd` : binaryName;
  return join(tmpdir(), 'claude-code-test-mock', fileName);
}

/**
 * Mock Claude CLI for testing
 * This creates a fake Claude CLI that can be used during testing
 */
export class ClaudeMock {
  private mockPath: string;
  private nodeScriptPath: string | null;
  private responses = new Map<string, string>();

  constructor(binaryName: string = 'claude') {
    this.mockPath = getClaudeMockPath(binaryName);
    this.nodeScriptPath = process.platform === 'win32'
      ? join(dirname(this.mockPath), `${binaryName}.cjs`)
      : null;
  }

  get path(): string {
    return this.mockPath;
  }

  /**
   * Setup the mock Claude CLI
   */
  async setup(): Promise<void> {
    const dir = dirname(this.mockPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (this.nodeScriptPath) {
      const mockScript = `const args = process.argv.slice(2);
let prompt = '';

for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '-p' || args[index] === '--prompt') {
    prompt = args[index + 1] || '';
    index += 1;
  }
}

if (prompt.includes('create') || prompt.includes('Create')) {
  process.stdout.write('Created file successfully\\n');
} else if (prompt.includes('git') && prompt.includes('commit')) {
  process.stdout.write('Committed changes successfully\\n');
} else if (prompt.includes('error')) {
  process.stderr.write('Error: Mock error response\\n');
  process.exitCode = 1;
} else {
  process.stdout.write('Command executed successfully\\n');
}
`;
      writeFileSync(this.nodeScriptPath, mockScript);
      writeFileSync(
        this.mockPath,
        `@ECHO off\r\n"${process.execPath}" "${this.nodeScriptPath}" %*\r\n`,
      );
      return;
    }

    // Create a simple bash script that echoes responses
    const mockScript = `#!/bin/bash
# Mock Claude CLI for testing

# Extract the prompt from arguments
prompt=""
verbose=false
while [[ $# -gt 0 ]]; do
  case $1 in
    -p|--prompt)
      prompt="$2"
      shift 2
      ;;
    --verbose)
      verbose=true
      shift
      ;;
    --yes|-y|--dangerously-skip-permissions)
      shift
      ;;
    *)
      shift
      ;;
  esac
done

# Mock responses based on prompt
if [[ "$prompt" == *"create"* ]]; then
  echo "Created file successfully"
elif [[ "$prompt" == *"Create"* ]]; then
  echo "Created file successfully"  
elif [[ "$prompt" == *"git"* ]] && [[ "$prompt" == *"commit"* ]]; then
  echo "Committed changes successfully"
elif [[ "$prompt" == *"error"* ]]; then
  echo "Error: Mock error response" >&2
  exit 1
else
  echo "Command executed successfully"
fi
`;

    writeFileSync(this.mockPath, mockScript);
    // Make executable
    const { chmod } = await import('node:fs/promises');
    await chmod(this.mockPath, 0o755);
  }

  /**
   * Cleanup the mock Claude CLI
   */
  async cleanup(): Promise<void> {
    const { rm } = await import('node:fs/promises');
    await rm(this.mockPath, { force: true });
    if (this.nodeScriptPath) {
      await rm(this.nodeScriptPath, { force: true });
    }
  }

  /**
   * Add a mock response for a specific prompt pattern
   */
  addResponse(pattern: string, response: string): void {
    this.responses.set(pattern, response);
  }
}
