import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Handling tests drive the car headless for many simulated seconds.
    testTimeout: 120_000,
  },
});
