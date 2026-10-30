import { beforeAll, describe, expect, it } from 'vitest';
import '../../../src/vitest.js';
import { loadOpenApiContract } from '../../../src/index.js';
import type { HttpExchange, OpenApiContract } from '../../../src/index.js';
import { matchers } from '../../../src/vitest.js';

const document = {
  openapi: '3.1.0',
  info: { title: 'Matcher', version: '1' },
  paths: {
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        responses: {
          '200': {
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

const exchange = (body: unknown, headers: Record<string, string>): HttpExchange => ({
  request: { method: 'GET', url: '/users/1' },
  response: { status: 200, headers, body },
});
const good = exchange({ id: 1 }, { 'content-type': 'application/json', 'x-request-id': 'r' });
const bad = exchange({ id: 'one' }, { 'content-type': 'application/json' });

describe('Vitest matcher toConformToOpenApi', () => {
  let contract: OpenApiContract;
  beforeAll(async () => {
    contract = await loadOpenApiContract({ document });
  });

  it('passes for a conforming exchange', () => {
    expect(good).toConformToOpenApi(contract);
  });

  it('fails with the formatted result, listing each problem', () => {
    let message = '';
    try {
      expect(bad).toConformToOpenApi(contract);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('OpenAPI response contract failed');
    expect(message).toContain('GET /users/1 (operation: GET /users/{id}, operationId: getUser)');
    expect(message).toContain('1. response.header_missing');
    expect(message).toContain('Header: X-Request-Id');
    expect(message).toContain('2. response.body.schema_invalid');
    expect(message).toContain('Path: $.id');
  });

  it('supports .not in both directions', () => {
    expect(bad).not.toConformToOpenApi(contract);
    expect(() => {
      expect(good).not.toConformToOpenApi(contract);
    }).toThrow(
      /not to conform to the OpenAPI contract, but it conforms to GET \/users\/\{id\} \(operationId: getUser\)/,
    );
    expect(() => {
      expect(bad).toConformToOpenApi(contract);
    }).toThrow(/contract failed/);
  });

  it('works with .resolves', async () => {
    await expect(Promise.resolve(good)).resolves.toConformToOpenApi(contract);
    await expect(Promise.resolve(bad)).resolves.not.toConformToOpenApi(contract);
  });

  it('works as an asymmetric matcher', () => {
    expect({ exchange: good }).toEqual({ exchange: expect.toConformToOpenApi(contract) });
    expect(() => {
      expect({ exchange: bad }).toEqual({ exchange: expect.toConformToOpenApi(contract) });
    }).toThrow();
  });

  it('agrees with contract.validateResponse (it is only a wrapper)', () => {
    for (const candidate of [good, bad]) {
      let passes = true;
      try {
        expect(candidate).toConformToOpenApi(contract);
      } catch {
        passes = false;
      }
      expect(passes).toBe(contract.validateResponse(candidate).valid);
    }
  });

  it('rejects misuse with a helpful error instead of a confusing failure', () => {
    expect(() => {
      expect(good).toConformToOpenApi(undefined as never);
    }).toThrow(/expects an OpenApiContract/);
    expect(() => {
      expect('not an exchange').toConformToOpenApi(contract);
    }).toThrow(/expects the received value to be an HTTP exchange/);
  });

  it('exports the matcher object for manual registration', () => {
    expect(Object.keys(matchers)).toEqual(['toConformToOpenApi']);
  });
});
