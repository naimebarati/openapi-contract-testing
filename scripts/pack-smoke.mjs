// Packs the package, installs the tarball into fresh, independent projects and uses it the way consumers do.
// Run after `npm run build`:  node scripts/pack-smoke.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(os.tmpdir(), 'oct-pack-'));
// On Windows npm and npx are .cmd shims, which Node can only start through a shell.
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
const write = (file, content) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
};

try {
  // 1. Tarball contents
  // Reproduce 0.1.0-beta.1: pack from a checkout that has not been built. `prepack` must build `dist/` itself.
  rmSync(path.join(root, 'dist'), { recursive: true, force: true });
  const output = run('npm', ['pack', '--json', '--pack-destination', work], root);
  // `prepack` prints the build log before npm's JSON, so parse from the last line that starts the JSON array.
  const packed = JSON.parse(output.slice(output.lastIndexOf('\n[') + 1));
  const [{ filename, files }] = packed;
  const names = files.map((f) => f.path);
  const allowed = [
    /^dist\//,
    /^package\.json$/,
    /^README\.md$/,
    /^LICENSE$/,
    /^NOTICE$/,
    /^CHANGELOG\.md$/,
    /^third-party\//,
  ];
  for (const name of names) {
    assert.ok(
      allowed.some((re) => re.test(name)),
      `unexpected file in tarball: ${name}`,
    );
  }
  for (const required of [
    'dist/index.js',
    'dist/index.cjs',
    'dist/index.d.ts',
    'dist/index.d.cts',
    'dist/jest.cjs',
    'dist/vitest.js',
    'LICENSE',
    'NOTICE',
    'README.md',
    'third-party/OpenAPI-Initiative-LICENSE-Apache-2.0.txt',
  ]) {
    assert.ok(names.includes(required), `missing from tarball: ${required}`);
  }
  console.log(
    `tarball ${filename}: ${names.length} files, ${(packed[0].size / 1024).toFixed(0)} kB packed`,
  );
  const tarball = path.join(work, filename);

  const spec = (version) => `openapi: ${version}
info: { title: Pack smoke, version: 1.0.0 }
paths:
  /ping:
    get:
      operationId: ping
      responses:
        '200':
          description: ok
          headers:
            X-Id: { required: true, schema: { type: string } }
          content:
            application/json:
              schema:
                type: object
                required: [ok]
                properties:
                  ok: { type: boolean }
`;

  const consumer = (name, type) => {
    const dir = path.join(work, name);
    mkdirSync(dir);
    write(path.join(dir, 'package.json'), JSON.stringify({ name, private: true, type }));
    write(path.join(dir, 'openapi-3.0.yaml'), spec('3.0.3'));
    write(path.join(dir, 'openapi-3.1.yaml'), spec('3.1.0'));
    write(path.join(dir, 'openapi-3.2.yaml'), spec('3.2.0'));
    return dir;
  };

  // 2. Plain JavaScript consumers (ESM and CJS): no TypeScript, no Jest, no Vitest installed.
  const esm = consumer('consumer-esm', 'module');
  const cjs = consumer('consumer-cjs', 'commonjs');
  const exercise = `
const good = { request: { method: 'GET', url: '/ping' }, response: { status: 200, headers: { 'content-type': 'application/json', 'x-id': '1' }, body: { ok: true } } };
const bad = { request: { method: 'GET', url: '/ping' }, response: { status: 200, headers: { 'content-type': 'application/json' }, body: { ok: 'yes' } } };
async function check(mod, label) {
  for (const version of ['3.0', '3.1', '3.2']) {
    const contract = await mod.loadOpenApiContract({ source: './openapi-' + version + '.yaml' });
    if (!contract.validateResponse(good).valid) throw new Error(label + ' ' + version + ': valid response rejected');
    const codes = contract.validateResponse(bad).errors.map((e) => e.code).join(',');
    if (codes !== 'response.header_missing,response.body.schema_invalid') throw new Error(label + ' ' + version + ': ' + codes);
  }
}`;
  write(
    path.join(esm, 'run.mjs'),
    `${exercise}
const main = await import('openapi-contract-testing');
await check(main, 'esm');
for (const sub of ['fetch', 'supertest', 'axios', 'fastify']) {
  const mod = await import('openapi-contract-testing/adapters/' + sub);
  if (Object.keys(mod).length === 0) throw new Error('empty adapter ' + sub);
}
await import('openapi-contract-testing/jest'); // no global expect: must load without Jest
try { await import('openapi-contract-testing/vitest'); throw new Error('vitest entry loaded without vitest'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
console.log('esm consumer ok');
`,
  );
  write(
    path.join(cjs, 'run.cjs'),
    `${exercise}
(async () => {
  await check(require('openapi-contract-testing'), 'cjs');
  for (const sub of ['fetch', 'supertest', 'axios', 'fastify']) {
    if (Object.keys(require('openapi-contract-testing/adapters/' + sub)).length === 0) throw new Error('empty adapter ' + sub);
  }
  require('openapi-contract-testing/jest');
  console.log('cjs consumer ok');
})().catch((e) => { console.error(e); process.exit(1); });
`,
  );
  for (const dir of [esm, cjs]) run('npm', ['install', '--no-audit', '--no-fund', tarball], dir);
  console.log(run('node', ['run.mjs'], esm).trim());
  console.log(run('node', ['run.cjs'], cjs).trim());

  // Only the declared runtime dependencies (and theirs) are installed; no frameworks or test runners.
  const installed = readdirSync(path.join(esm, 'node_modules'));
  for (const forbidden of [
    'jest',
    'vitest',
    'express',
    'fastify',
    'axios',
    'supertest',
    'typescript',
    '@nestjs',
  ]) {
    assert.ok(!installed.includes(forbidden), `${forbidden} must not be installed by the package`);
  }
  const pkg = JSON.parse(
    readFileSync(path.join(esm, 'node_modules/openapi-contract-testing/package.json'), 'utf8'),
  );
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
    'ajv',
    'ajv-draft-04',
    'ajv-formats',
    'yaml',
  ]);

  // 3. TypeScript consumers (ESM and CJS, NodeNext) compile against the shipped declarations.
  // The module settings real projects use. Node10 is the default of many NestJS/CommonJS projects: it ignores
  // `exports`, so the sub-path types (`.../adapters/*`) only resolve through `typesVersions`.
  const resolutions = {
    nodenext: { module: 'NodeNext', moduleResolution: 'NodeNext' },
    bundler: { module: 'ESNext', moduleResolution: 'Bundler' },
    node16: { module: 'Node16', moduleResolution: 'Node16' },
    node10: { module: 'CommonJS', moduleResolution: 'Node10', ignoreDeprecations: '6.0' },
  };
  for (const [name, type, resolution] of [
    ['ts-esm', 'module', 'nodenext'],
    ['ts-cjs', 'commonjs', 'nodenext'],
    ['ts-bundler', 'module', 'bundler'],
    ['ts-node16', 'commonjs', 'node16'],
    ['ts-node10', 'commonjs', 'node10'],
  ]) {
    const dir = consumer(name, type);
    write(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          ...resolutions[resolution],
          target: 'ES2022',
          noEmit: true,
          skipLibCheck: false,
          types: ['node'],
        },
        include: ['src'],
      }),
    );
    write(
      path.join(dir, 'src/index.ts'),
      `
import { loadOpenApiContract, OpenApiContractAssertionError } from 'openapi-contract-testing';
import type { ContractValidationResult, HttpExchange } from 'openapi-contract-testing';
import { fromFetch } from 'openapi-contract-testing/adapters/fetch';
import { fromSupertest } from 'openapi-contract-testing/adapters/supertest';
import { fromAxios } from 'openapi-contract-testing/adapters/axios';
import { fromFastifyInject } from 'openapi-contract-testing/adapters/fastify';

export async function check(exchange: HttpExchange): Promise<ContractValidationResult> {
  const contract = await loadOpenApiContract({ source: './openapi-3.1.yaml', validation: { unsupportedFeaturePolicy: 'warning' } });
  try { contract.assertResponse(exchange); } catch (error) { if (error instanceof OpenApiContractAssertionError) return error.result; throw error; }
  return contract.validateResponse(exchange);
}
export const adapters = [fromFetch, fromSupertest, fromAxios, fromFastifyInject];
// @ts-expect-error remote references are not supported
export const rejected = loadOpenApiContract({ source: 'x', refs: { allowRemote: true } });
`,
    );
    run(
      'npm',
      ['install', '--no-audit', '--no-fund', tarball, 'typescript@~6.0.3', '@types/node@22'],
      dir,
    );
    run('npx', ['tsc', '-p', 'tsconfig.json'], dir);
    console.log(`${name}: tsc (${resolution}, strict, skipLibCheck: false) ok`);
  }
  console.log('pack smoke test passed');
} finally {
  rmSync(work, { recursive: true, force: true });
}
