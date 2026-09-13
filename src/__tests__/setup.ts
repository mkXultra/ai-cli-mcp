// Global test setup
import { beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { getSharedMock, cleanupSharedMock } from './utils/persistent-mock.js';

process.env.AI_CLI_CONFIG_PATH = fileURLToPath(new URL('./fixtures/empty-config.json', import.meta.url));

beforeAll(async () => {
  console.error('[TEST SETUP] Creating shared mock for all tests...');
  await getSharedMock();
});

afterAll(async () => {
  console.error('[TEST SETUP] Cleaning up shared mock...');
  await cleanupSharedMock();
});
