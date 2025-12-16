import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    outDir: 'dist',
    sourcemap: true,
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    treeshake: true,
    shims: true,
    skipNodeModulesBundle: false,
    target: 'node22',
    noExternal: [],
  },
]);
