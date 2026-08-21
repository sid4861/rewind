import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [pluginReact()],
  html: {
    title: 'Northwind Ops',
    template: './index.html',
  },
  source: {
    entry: { index: './src/index.tsx' },
  },
  resolve: {
    alias: {
      /*
       * The inner development loop.
       *
       * These point at `src`, not `dist`, so editing the recorder or the schema
       * hot-reloads this app with no intermediate library build. Rspack resolves
       * through this map; `tsconfig.base.json` paths handle the typechecker.
       * Library *builds* deliberately do not use these — rslib resolves
       * `@rewind/session-schema` through node_modules so it stays external
       * rather than being inlined into the recorder bundle.
       */
      '@rewind/session-schema': resolve(here, '../session-schema/src/index.ts'),
      '@rewind/session-schema/validation': resolve(
        here,
        '../session-schema/src/validation/index.ts',
      ),
      '@rewind/session-recorder': resolve(here, '../session-recorder/src/index.ts'),
    },
  },
  server: {
    port: 4300,
    // React Router owns the URL; unknown paths must serve index.html rather
    // than 404, or a hard refresh on /orders breaks.
    historyApiFallback: true,
  },
  performance: {
    /*
     * Enabled with ANALYZE=1, so it never slows a normal build.
     *
     * The report is what the production-exclusion check (PLAN.md 4.9 guard #5)
     * asserts against: proving the recorder is absent from a host app's bundle
     * has to be a machine-checked assertion, not an eyeball on a treemap.
     */
    ...(process.env.ANALYZE
      ? { bundleAnalyze: { analyzerMode: 'static', openAnalyzer: false } }
      : {}),
  },
  output: {
    distPath: { root: 'dist' },
  },
});
