import { existsSync } from 'node:fs';
import { getClaudeMockPath } from './claude-mock.js';

export function verifyMockExists(binaryName: string): boolean {
  return existsSync(getClaudeMockPath(binaryName));
}

export async function ensureMockExists(mock: any): Promise<void> {
  if (!verifyMockExists('claudeMocked')) {
    await mock.setup();
  }
}
