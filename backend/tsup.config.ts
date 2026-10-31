import { defineConfig } from 'tsup';

// Bundles the server (and the workspace-local @hgv/shared source) into dist/index.js.
// Third-party dependencies stay external and are loaded from node_modules at runtime.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: ['@hgv/shared'],
});
