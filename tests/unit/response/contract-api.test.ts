import { describe, expect, it } from 'vitest';
import {
  OpenApiContractAssertionError,
  OpenApiSpecError,
  formatValidationResult,
  loadOpenApiContract,
  toJsonPath,
} from '../../../src/index.js';
import { fixture, oas } from '../../helpers/contracts.js';
import { codes, contractFor, json, response } from '../../helpers/exchanges.js';

const user = { id: 'u1', email: 'a@b.co', nickname: null, age: 30 };
const okExchange = (
  body: unknown = user,
  headers: Record<string, string> = { 'content-type': 'application/json', 'x-request-id': 'r1' },
) => response(200, { headers, body }, { url: '/api/v1/users/123' });

describe.each([
  ['3.0', 'openapi-3.0/users.yaml', 'application/json'],
  ['3.1', 'openapi-3.1/users.yaml', 'application/problem+json'],
  ['3.2', 'openapi-3.2/users.yaml', 'application/problem+json'],
])('OpenAPI %s fixture', (version, file, errorType) => {
  it('accepts a conforming response', async () => {
    const contract = await loadOpenApiContract({ source: fixture(file) });
    const result = contract.validateResponse(okExchange());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.operation).toEqual({
      method: 'GET',
      path: '/users/{id}',
      operationId: 'getUser',
    });
    expect(contract.getOperations()).toEqual([
      { method: 'GET', path: '/users/{id}', operationId: 'getUser', responses: ['200', '404'] },
    ]);
    expect(contract.getWarnings()).toEqual([]);
  });

  it('reports status, content-type, header and property problems independently', async () => {
    const contract = await loadOpenApiContract({ source: fixture(file) });
    expect(codes(contract.validateResponse(response(500, {}, { url: '/api/v1/users/1' })))).toEqual(
      ['response.status_not_documented'],
    );
    expect(
      codes(
        contract.validateResponse(
          okExchange(user, { 'content-type': 'text/plain', 'x-request-id': 'r' }),
        ),
      ),
    ).toEqual(['response.content_type_unexpected']);
    expect(
      codes(contract.validateResponse(okExchange(user, { 'content-type': 'application/json' }))),
    ).toEqual(['response.header_missing']);
    const property = contract.validateResponse(okExchange({ ...user, email: 42 }));
    expect(property.errors).toEqual([
      expect.objectContaining({
        code: 'response.body.schema_invalid',
        instancePath: '/email',
        keyword: 'type',
      }),
    ]);
    expect(
      codes(
        contract.validateResponse(
          response(
            404,
            { headers: { 'content-type': errorType }, body: { message: 'nope' } },
            { url: '/api/v1/users/9' },
          ),
        ),
      ),
    ).toEqual([]);
  });

  it('applies the dialect specific numeric bound and null handling', async () => {
    const contract = await loadOpenApiContract({ source: fixture(file) });
    expect(contract.validateResponse(okExchange({ ...user, age: 1 })).valid).toBe(true);
    expect(contract.validateResponse(okExchange({ ...user, age: 0 })).valid).toBe(false); // exclusive minimum 0
    expect(
      contract.validateResponse(okExchange({ id: 'x', email: 'a@b.co', nickname: 'nick' })).valid,
    ).toBe(true);
    expect(
      contract.validateResponse(okExchange({ id: 'x', email: 'a@b.co', nickname: 5 })).valid,
    ).toBe(false);
    expect(version).toMatch(/^3\.[012]$/);
  });
});

describe('assertResponse', () => {
  it('returns nothing for valid responses and for responses with only warnings', async () => {
    const contract = await loadOpenApiContract({ source: fixture('openapi-3.1/users.yaml') });
    expect(() => {
      contract.assertResponse(okExchange());
    }).not.toThrow();
  });

  it('throws OpenApiContractAssertionError with the structured result and a readable message', async () => {
    const contract = await loadOpenApiContract({ source: fixture('openapi-3.1/users.yaml') });
    const bad = okExchange({ id: 'x', email: 42 }, { 'content-type': 'application/json' });
    let thrown: unknown;
    try {
      contract.assertResponse(bad);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OpenApiContractAssertionError);
    const error = thrown as OpenApiContractAssertionError;
    expect(error.result.valid).toBe(false);
    expect(error.result.errors.map((e) => e.code)).toEqual([
      'response.header_missing',
      'response.body.schema_invalid',
    ]);
    expect(error.message).toBe(formatValidationResult(error.result));
    expect(error.message).toContain('OpenAPI response contract failed');
    expect(error.message).toContain(
      'GET /api/v1/users/123 (operation: GET /users/{id}, operationId: getUser)',
    );
    expect(error.message).toContain('Actual response: 200 OK');
    expect(error.message).toContain('1. response.header_missing');
    expect(error.message).toContain('Header: X-Request-Id');
    expect(error.message).toContain('2. response.body.schema_invalid');
    expect(error.message).toContain('Path: $.email');
    expect(error.message).toContain('Message: must be string (received integer)');
    expect(error.message).toContain('Contract: /components/schemas/User/properties/email/type');
  });

  it('createAssertionError wraps any result', async () => {
    const contract = await contractFor({ '200': { description: 'ok' } });
    const result = contract.validateResponse(response(500));
    expect(contract.createAssertionError(result).result).toBe(result);
  });

  it('validateResponse never throws for contract violations', async () => {
    const contract = await contractFor({ '200': { description: 'ok' } });
    expect(() => contract.validateResponse(response(500, {}, { url: '/unknown' }))).not.toThrow();
  });
});

describe('formatting', () => {
  it('renders JSON paths', () => {
    expect(toJsonPath('')).toBe('$');
    expect(toJsonPath('/data/items/0/id')).toBe('$.data.items[0].id');
    expect(toJsonPath("/a~1b/c d/it's")).toBe("$['a/b']['c d']['it\\'s']");
  });

  it('renders text and JSON, with a stable JSON shape and no timing noise', async () => {
    const contract = await contractFor({
      '200': {
        description: 'ok',
        headers: { 'X-A': { required: true, schema: { type: 'string' } } },
      },
    });
    const result = contract.validateResponse(response(200));
    const parsed = JSON.parse(formatValidationResult(result, { format: 'json' })) as Record<
      string,
      unknown
    >;
    expect(parsed['valid']).toBe(false);
    expect(parsed).not.toHaveProperty('durationMs');
    expect(formatValidationResult(result)).toContain('Header: X-A');
  });

  it('lists warnings separately', async () => {
    const contract = await contractFor({
      '200': { description: 'ok', content: { 'application/xml': {} } },
    });
    const result = contract.validateResponse(
      response(200, { headers: { 'content-type': 'application/xml' }, rawBody: '<a/>' }),
    );
    expect(result.valid).toBe(true);
    const text = formatValidationResult(result);
    expect(text).toContain('passed with warnings');
    expect(text).toContain('response.body_validation_unsupported');
  });
});

describe('contract instances', () => {
  it('are immutable and independent of later changes to the input document', async () => {
    const document = oas({
      '/a': {
        get: {
          responses: {
            '200': {
              description: 'ok',
              content: { 'application/json': { schema: { type: 'object', required: ['a'] } } },
            },
          },
        },
      },
    });
    const contract = await loadOpenApiContract({ document });
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.getOperations())).toBe(true);
    const before = contract.validateResponse(
      response(200, { headers: json, body: { b: 1 } }, { url: '/a' }),
    );
    ((document['paths'] as Record<string, unknown>)['/a'] as Record<string, unknown>)['get'] = {
      responses: { '200': { description: 'changed' } },
    };
    const after = contract.validateResponse(
      response(200, { headers: json, body: { b: 1 } }, { url: '/a' }),
    );
    expect(codes(after)).toEqual(codes(before));
  });

  it('keep no state between calls: interleaved concurrent validations give independent results', async () => {
    const contract = await contractFor({
      '200': {
        description: 'ok',
        content: {
          'application/json': {
            schema: { type: 'object', required: ['ok'], properties: { ok: { const: true } } },
          },
        },
      },
    });
    const run = (n: number) =>
      Promise.resolve().then(
        () =>
          contract.validateResponse(response(200, { headers: json, body: { ok: n % 2 === 0 } }))
            .valid,
      );
    const results = await Promise.all(Array.from({ length: 200 }, (_, n) => run(n)));
    expect(results).toEqual(Array.from({ length: 200 }, (_, n) => n % 2 === 0));
  });
});

describe('load-time policy for unsupported features', () => {
  const doc31 = oas({
    '/a': {
      get: {
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { type: 'string', nullable: true } } },
          },
        },
      },
    },
  });

  it('fails the load by default and names the feature', async () => {
    const error = await loadOpenApiContract({ document: doc31 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OpenApiSpecError);
    expect((error as OpenApiSpecError).issues[0]).toMatchObject({
      code: 'spec.unsupported_feature',
    });
    expect((error as Error).message).toContain('nullable');
    expect((error as Error).message).toContain("unsupportedFeaturePolicy to 'warning'");
  });

  it("loads with warnings when the policy is 'warning'", async () => {
    const contract = await loadOpenApiContract({
      document: doc31,
      validation: { unsupportedFeaturePolicy: 'warning' },
    });
    expect(contract.getWarnings()).toEqual([
      expect.objectContaining({ code: 'spec.unsupported_feature', severity: 'warning' }),
    ]);
    // The unsupported keyword has no effect, which is exactly what the warning says: null is rejected.
    expect(
      contract.validateResponse(response(200, { headers: json, body: null }, { url: '/a' })).valid,
    ).toBe(false);
  });
});

describe('direction-aware and polymorphic schemas through the public API', () => {
  it('does not require writeOnly properties and flags them when present', async () => {
    const contract = await contractFor({
      '200': {
        description: 'ok',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['id', 'password'],
              properties: {
                id: { type: 'string', readOnly: true },
                password: { type: 'string', writeOnly: true },
              },
            },
          },
        },
      },
    });
    expect(
      contract.validateResponse(response(200, { headers: json, body: { id: '1' } })).valid,
    ).toBe(true);
    const leak = contract.validateResponse(
      response(200, { headers: json, body: { id: '1', password: 'hunter2' } }),
    );
    expect(leak.errors).toEqual([
      expect.objectContaining({
        code: 'response.body.schema_invalid',
        instancePath: '/password',
        keyword: 'writeOnly',
      }),
    ]);
    expect(JSON.stringify(leak)).not.toContain('hunter2');
    const asWarning = await contractFor(
      {
        '200': {
          description: 'ok',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { password: { type: 'string', writeOnly: true } },
              },
            },
          },
        },
      },
      { options: { validation: { writeOnlyInResponse: 'warning' } } },
    );
    const result = asWarning.validateResponse(
      response(200, { headers: json, body: { password: 'x' } }),
    );
    expect(result.valid).toBe(true);
    expect(result.warnings[0]).toMatchObject({
      code: 'response.body.schema_invalid',
      keyword: 'writeOnly',
      severity: 'warning',
    });
  });

  it('uses the discriminator to pick a variant', async () => {
    const contract = await contractFor(
      {
        '200': {
          description: 'ok',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
        },
      },
      {
        components: {
          schemas: {
            Pet: {
              oneOf: [{ $ref: '#/components/schemas/Cat' }, { $ref: '#/components/schemas/Dog' }],
              discriminator: { propertyName: 'kind' },
            },
            Cat: {
              type: 'object',
              properties: { kind: { type: 'string' }, meow: { type: 'string' } },
            },
            Dog: {
              type: 'object',
              properties: { kind: { type: 'string' }, bark: { type: 'string' } },
            },
          },
        },
      },
    );
    const at = (body: unknown) => contract.validateResponse(response(200, { headers: json, body }));
    expect(at({ kind: 'Cat', meow: 'x' }).valid).toBe(true);
    expect(at({ kind: 'Dog', bark: 'x' }).valid).toBe(true);
    const bad = at({ kind: 'Dog', bark: 5 });
    expect(bad.errors.map((e) => [e.instancePath, e.schemaPath])).toEqual([
      ['/bark', '/components/schemas/Dog/properties/bark/type'],
    ]);
  });
});
