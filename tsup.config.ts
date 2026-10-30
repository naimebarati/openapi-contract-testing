import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'adapters/fetch': 'src/adapters/fetch.ts',
    'adapters/supertest': 'src/adapters/supertest.ts',
    'adapters/axios': 'src/adapters/axios.ts',
    'adapters/fastify': 'src/adapters/fastify.ts',
  },
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
