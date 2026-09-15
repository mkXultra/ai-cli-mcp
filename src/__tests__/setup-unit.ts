import { afterEach, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';

// Never read the developer's personal aliases in the deterministic test suite.
process.env.AI_CLI_CONFIG_PATH = fileURLToPath(new URL('./fixtures/empty-config.json', import.meta.url));

const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
const baselineListeners = new Map<NodeJS.Signals, NodeJS.SignalsListener[]>();

beforeEach(() => {
  for (const signal of signals) baselineListeners.set(signal, process.listeners(signal) as NodeJS.SignalsListener[]);
});

afterEach(() => {
  for (const signal of signals) {
    for (const listener of process.listeners(signal) as NodeJS.SignalsListener[]) {
      if (!baselineListeners.get(signal)?.includes(listener)) process.removeListener(signal, listener);
    }
  }
});
