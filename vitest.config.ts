import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolveSource = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@openmimic/shared': resolveSource('./shared/src/index.ts'),
      '@openmimic/kernel': resolveSource('./kernel/src/index.ts'),
      '@openmimic/engine-court': resolveSource('./engines/court/src/index.ts'),
      '@openmimic/engine-witness': resolveSource('./engines/witness/src/index.ts'),
      '@openmimic/server': resolveSource('./server/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: [
      'shared/**/*.test.ts',
      'kernel/**/*.test.ts',
      'engines/**/*.test.ts',
      'server/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
