import { defineConfig } from '@rslib/core';

export default defineConfig({
  source: { entry: { index: './src/index.ts' } },
  lib: [
    { format: 'esm', syntax: 'es2022', dts: true },
    { format: 'cjs', syntax: 'es2022' },
  ],
  output: {
    target: 'web',
    // React and the schema stay external: the schema is a workspace dependency
    // resolved through node_modules, and bundling React would give a host app
    // two copies of it.
    externals: ['react', 'react-dom', 'react/jsx-runtime', '@rewind/session-schema'],
  },
});
