import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/__tests__/**/*.ts', 'src/**/__tests__/**/*.tsx', 'tests/**/*.test.ts'],
    // Multiple test files share a single live Postgres and use overlapping
    // 1C fixture externalIds; running them in parallel forks causes
    // cross-file cleanup races. Keep file execution sequential.
    fileParallelism: false
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
});
