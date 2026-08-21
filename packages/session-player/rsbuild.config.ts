import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [pluginReact()],
  html: { title: 'Rewind Player', template: './index.html' },
  source: { entry: { index: './src/index.tsx' } },
  resolve: {
    alias: {
      // Schema only. The player must never reach the recorder — the Nx boundary
      // rule enforces it, and deliberately not aliasing it here means an
      // accidental import fails at resolve time too.
      '@rewind/session-schema': resolve(here, '../session-schema/src/index.ts'),
      '@rewind/session-schema/validation': resolve(
        here,
        '../session-schema/src/validation/index.ts',
      ),
    },
  },
  server: { port: 4400 },
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
  output: { distPath: { root: 'dist' } },
});
