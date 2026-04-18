import { defineConfig } from 'vitest/config';

const timeoutMs = Number(process.env.ACM_LIVE_E2E_TEST_TIMEOUT_MS || 420_000);

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/live-cli-e2e.test.ts'],
    testTimeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 420_000,
    hookTimeout: 60_000,
    mockReset: true,
    clearMocks: true,
    restoreMocks: true,
  },
});
