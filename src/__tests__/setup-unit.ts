import { afterEach, beforeEach } from 'vitest';

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
