import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@nikount/source'] },
  test: { include: ['test/**/*.test.ts'] },
});
