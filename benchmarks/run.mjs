// Benchmark: a 1000-operation contract and 10,000 repeated validations (design brief, section 16.6).
// Usage: npm run build && node benchmarks/run.mjs [--json]
import { performance } from 'node:perf_hooks';
import { loadOpenApiContract } from '../dist/index.js';

const OPERATIONS = 1000;
const VALIDATIONS = 10_000;
const SCHEMAS = 100;

function buildDocument() {
  const schemas = {};
  for (let i = 0; i < SCHEMAS; i++) {
    schemas[`Model${i}`] = {
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: { type: 'integer' },
        name: { type: 'string', minLength: 1 },
        email: { type: 'string', format: 'email' },
        tags: { type: 'array', items: { type: 'string' } },
        // Cyclic reference to the next model, like real-world linked resources.
        next: { $ref: `#/components/schemas/Model${(i + 1) % SCHEMAS}` },
      },
    };
  }
  const paths = {};
  for (let i = 0; i < OPERATIONS / 2; i++) {
    const responses = (n) => ({
      200: {
        description: 'ok',
        headers: { 'X-Request-Id': { required: true, schema: { type: 'string' } } },
        content: {
          'application/json': { schema: { $ref: `#/components/schemas/Model${n % SCHEMAS}` } },
        },
      },
      404: {
        description: 'missing',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['message'],
              properties: { message: { type: 'string' } },
            },
          },
        },
      },
    });
    paths[`/resource${i}/{id}`] = {
      get: { operationId: `get${i}`, responses: responses(i) },
      put: { operationId: `put${i}`, responses: responses(i + 1) },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Bench', version: '1' },
    servers: [{ url: '/api' }],
    paths,
    components: { schemas },
  };
}

const document = buildDocument();
const memoryBefore = process.memoryUsage().heapUsed;
const loadStart = performance.now();
const contract = await loadOpenApiContract({ document });
const loadMs = performance.now() - loadStart;
const memoryMb = (process.memoryUsage().heapUsed - memoryBefore) / 1024 / 1024;

const body = {
  id: 1,
  name: 'n',
  email: 'a@b.co',
  tags: ['x'],
  next: { id: 2, name: 'm', next: { id: 3, name: 'o' } },
};
const headers = { 'content-type': 'application/json', 'x-request-id': 'r' };
const exchanges = Array.from({ length: OPERATIONS / 2 }, (_, i) => ({
  request: { method: 'GET', url: `/api/resource${i}/42?x=1` },
  response: { status: 200, headers, body },
}));
const invalid = { ...exchanges[0], response: { ...exchanges[0].response, body: { id: 'x' } } };

// warm-up
for (let i = 0; i < 500; i++) contract.validateResponse(exchanges[i % exchanges.length]);

const start = performance.now();
let valid = 0;
for (let i = 0; i < VALIDATIONS; i++) {
  if (contract.validateResponse(exchanges[(i * 7) % exchanges.length]).valid) valid++;
}
const validMs = performance.now() - start;

const invalidStart = performance.now();
let invalidCount = 0;
for (let i = 0; i < 1000; i++) if (!contract.validateResponse(invalid).valid) invalidCount++;
const invalidMs = performance.now() - invalidStart;

const result = {
  node: process.version,
  operations: contract.getOperations().length,
  loadAndCompileMs: Math.round(loadMs),
  loadHeapMb: Math.round(memoryMb),
  validations: VALIDATIONS,
  validResponses: valid,
  validationsTotalMs: Math.round(validMs),
  validationsPerSecond: Math.round(VALIDATIONS / (validMs / 1000)),
  invalidResponses1000Ms: Math.round(invalidMs),
  invalidResponsesAllReported: invalidCount === 1000,
};
if (process.argv.includes('--json')) console.log(JSON.stringify(result));
else console.table(result);
if (valid !== VALIDATIONS || invalidCount !== 1000) {
  console.error('Benchmark produced unexpected validation results');
  process.exit(1);
}
