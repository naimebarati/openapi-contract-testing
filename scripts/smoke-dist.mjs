// Verifies the built package from both module systems. Run after `npm run build`.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const esm = await import('../dist/index.js');
const cjs = createRequire(import.meta.url)('../dist/index.cjs');

const document = {
  openapi: '3.1.0',
  info: { title: 'Smoke', version: '1' },
  paths: {
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        responses: {
          200: {
            description: 'ok',
            headers: { 'X-Request-Id': { required: true, schema: { type: 'string' } } },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id'],
                  properties: { id: { type: 'integer' } },
                },
              },
            },
          },
        },
      },
    },
  },
};

const exchange = (body, headers) => ({
  request: { method: 'GET', url: '/users/1' },
  response: { status: 200, headers, body },
});

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

  const contract = await mod.loadOpenApiContract({ document });
  const good = contract.validateResponse(
    exchange({ id: 1 }, { 'content-type': 'application/json', 'x-request-id': 'a' }),
  );
  assert.equal(good.valid, true, `${label}: valid response`);
  const bad = contract.validateResponse(
    exchange({ id: 'one' }, { 'content-type': 'application/json' }),
  );
  assert.deepEqual(
    bad.errors.map((e) => e.code),
    ['response.header_missing', 'response.body.schema_invalid'],
    `${label}: invalid response`,
  );
  assert.throws(() => contract.assertResponse(exchange({}, {})), mod.OpenApiContractAssertionError);

  // OpenAPI 3.0 uses a different Ajv instance (draft-04); make sure it is bundled correctly too.
  const legacy = await mod.loadOpenApiContract({
    document: { ...document, openapi: '3.0.3' },
  });
  assert.equal(legacy.getOperations().length, 1, `${label}: 3.0 document`);
}
console.log('dist smoke test passed (esm + cjs)');
