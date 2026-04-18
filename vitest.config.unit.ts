import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/__tests__/setup-unit.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
    },
    exclude: [
      'node_modules/**',
      'dist/**',
      'src/__tests__/e2e.test.ts',
      'src/__tests__/edge-cases.test.ts',
      'src/__tests__/live-cli-e2e.test.ts',
      'src/__tests__/package-smoke.test.ts',
    ],
    mockReset: true,
    clearMocks: true,
    restoreMocks: true,
  },
});
