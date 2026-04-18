import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/package-smoke.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 20_000,
    mockReset: true,
    clearMocks: true,
    restoreMocks: true,
  },
});
