import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/unit/**/*.test.ts',
      'tests/security/**/*.test.ts',
      'tests/integration/**/*.test.ts',
    ],
    coverage: { provider: 'v8', include: ['src/**'], reporter: ['text', 'lcov'] },
  },
});
