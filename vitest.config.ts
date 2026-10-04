import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', 'src/**/*.{test,spec}.tsx'],
    coverage: {
      provider: 'v8',
      // #99 AC4: per-module coverage, printed in CI. No threshold yet: this
      // reports, it does not gate. `maxCols` keeps file names untruncated in
      // the CI log, which has no terminal width to size to.
      reporter: [['text', { maxCols: 200 }], 'text-summary', 'html'],
      include: ['src/**/*.{ts,tsx}', 'App.tsx'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', 'node_modules/', 'dist/'],
      // Untested modules (the screens) appear at 0% rather than vanishing.
      all: true
    }
  }
});
