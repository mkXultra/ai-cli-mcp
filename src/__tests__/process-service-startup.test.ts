import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProcessService } from '../process-service.js';

describe('ProcessService startup failures', () => {
  it('consumes the child error event when spawning fails before a PID is assigned', async () => {
    const missingCommand = join(process.cwd(), `missing-ai-cli-${process.pid}-${Date.now()}`);
    const service = new ProcessService({
      cliPaths: {
        claude: missingCommand,
        codex: missingCommand,
        gemini: missingCommand,
        forge: missingCommand,
        opencode: missingCommand,
      },
    });

    expect(() => service.startProcess({
      prompt: 'startup failure test',
      workFolder: process.cwd(),
    })).toThrow('Failed to start claude CLI process');

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(service.listProcesses()).toEqual([]);
  });

  it.runIf(process.platform === 'win32')('rejects a missing bare command before reporting started', () => {
    const missingCommand = `missing-ai-cli-${process.pid}-${Date.now()}`;
    const service = new ProcessService({
      cliPaths: {
        claude: missingCommand,
        codex: missingCommand,
        gemini: missingCommand,
        forge: missingCommand,
        opencode: missingCommand,
      },
    });

    expect(() => service.startProcess({
      prompt: 'bare startup failure test',
      workFolder: process.cwd(),
    })).toThrow('Failed to start claude CLI process');
    expect(service.listProcesses()).toEqual([]);
  });
});
