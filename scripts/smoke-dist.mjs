// Verifies the built package from both module systems. Run after `npm run build`.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const esm = await import('../dist/index.js');
const cjs = createRequire(import.meta.url)('../dist/index.cjs');

for (const [label, mod] of [
  ['esm', esm],
  ['cjs', cjs],
]) {
  assert.equal(typeof mod.OpenApiSpecError, 'function', `${label}: OpenApiSpecError`);
  assert.ok(Array.isArray(mod.ISSUE_CODES), `${label}: ISSUE_CODES`);
  assert.ok(
    new mod.OpenApiConfigError('x') instanceof mod.OpenApiContractError,
    `${label}: error hierarchy`,
  );
}
console.log('dist smoke test passed (esm + cjs)');
