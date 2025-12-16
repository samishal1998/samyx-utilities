import { defineConfig } from 'vitest/config';

/**
 * Shared Vitest configuration for all packages in the monorepo.
 * Individual packages can extend or override this configuration.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/build/**',
        '**/coverage/**',
      ],
      reportsDirectory: './coverage',
    },
    // Run tests in parallel for better performance
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
      },
    },
  },
});
