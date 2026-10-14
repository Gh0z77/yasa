import { defineConfig } from 'vitest/config';

// The same suite on the Postgres code path (an embedded Postgres, no server needed): `npm run test:pg`.
// Slower than SQLite, so fewer workers and longer timeouts.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    maxWorkers: 2,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      YASA_TEST_DB: 'pglite',
    },
  },
});
