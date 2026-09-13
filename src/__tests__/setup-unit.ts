import { afterEach, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';

// Never read the developer's personal aliases in the deterministic test suite.
process.env.AI_CLI_CONFIG_PATH = fileURLToPath(new URL('./fixtures/empty-config.json', import.meta.url));

let baselineSigintListeners: NodeJS.SignalsListener[] = [];

beforeEach(() => {
  baselineSigintListeners = process.listeners('SIGINT') as NodeJS.SignalsListener[];
});

afterEach(() => {
  for (const listener of process.listeners('SIGINT') as NodeJS.SignalsListener[]) {
    if (!baselineSigintListeners.includes(listener)) {
      process.removeListener('SIGINT', listener);
    }
  }
});
