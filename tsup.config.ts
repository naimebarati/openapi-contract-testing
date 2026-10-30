import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
});
