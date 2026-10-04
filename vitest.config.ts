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
      '@openmimic/engine-room': resolveSource('./engines/room/src/index.ts'),
      '@openmimic/engine-witness': resolveSource('./engines/witness/src/index.ts'),
      '@openmimic/server': resolveSource('./server/src/index.ts'),
      '@openmimic/fixtures': resolveSource('./fixtures/limo.ts'),
      '@openmimic/collector-freetext': resolveSource('./plugins/collector-freetext/src/index.ts'),
      '@openmimic/scenario-review': resolveSource('./plugins/scenario-review/src/index.ts'),
      '@openmimic/example-bridge': resolveSource('./plugins/example-bridge/src/index.ts'),
      '@openmimic/core': resolveSource('./packages/core/src/index.ts'),
      '@openmimic/eval': resolveSource('./eval/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: [
      'shared/**/*.test.ts',
      'kernel/**/*.test.ts',
      'engines/**/*.test.ts',
      'server/**/*.test.ts',
      'web/**/*.test.ts',
      'plugins/**/*.test.ts',
      'packages/**/*.test.ts',
      'examples/**/*.test.ts',
      'eval/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
