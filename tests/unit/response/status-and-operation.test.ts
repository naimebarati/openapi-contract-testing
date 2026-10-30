import { describe, expect, it } from 'vitest';
import { OpenApiInputError } from '../../../src/index.js';
import { codes, contractFor, json, response } from '../../helpers/exchanges.js';

const ok = { description: 'ok' };

describe('operation lookup', () => {
  it('reports operation.not_found with the documented methods', async () => {
    const contract = await contractFor({ '200': ok });
    const result = contract.validateResponse(response(200, {}, { method: 'POST' }));
    expect(result.valid).toBe(false);
    expect(result.operation).toBeUndefined();
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: 'operation.not_found',
        method: 'POST',
        actualPath: '/thing',
        expected: { documentedMethods: ['GET'] },
      }),
    ]);
    expect(result.errors[0]?.message).toContain('documented for GET');
  });

  it('never prints query strings or fragments in diagnostics', async () => {
    const contract = await contractFor({ '200': ok });
    const result = contract.validateResponse(
      response(200, {}, { url: 'http://localhost/missing?token=SECRET#frag' }),
    );
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(result.errors[0]?.actualPath).toBe('/missing');
  });

  it('reports request.invalid_url for unusable URLs', async () => {
    const contract = await contractFor({ '200': ok });
    for (const url of ['thing', 'ftp://host/thing', '//host/thing', '/thing/%zz']) {
      expect(codes(contract.validateResponse(response(200, {}, { url }))), url).toEqual([
        'request.invalid_url',
      ]);
    }
  });

  it('normalizes the method to upper case and accepts absolute URLs and URL objects', async () => {
    const contract = await contractFor({ '200': ok });
    expect(
      contract.validateResponse(
        response(200, {}, { method: 'get', url: 'http://localhost:3000/thing?x=1' }),
      ).valid,
    ).toBe(true);
    expect(
      contract.validateResponse(response(200, {}, { url: new URL('https://example.org/thing') }))
        .valid,
    ).toBe(true);
  });

  it('does not turn HEAD, OPTIONS or QUERY into GET', async () => {
    const contract = await contractFor({ '200': ok });
    for (const method of ['HEAD', 'OPTIONS', 'QUERY']) {
      expect(codes(contract.validateResponse(response(200, {}, { method }))), method).toEqual([
        'operation.not_found',
      ]);
    }
  });

  it('returns operation details and the operationId on success', async () => {
    const contract = await contractFor({ '200': ok });
    expect(contract.validateResponse(response(200)).operation).toEqual({
      method: 'GET',
      path: '/thing',
      operationId: 'thing',
    });
  });

  it('reports operation.ambiguous instead of guessing', async () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 't', version: '1' },
      paths: {
        '/{x}/b/c': { get: { responses: { '200': ok } } },
        '/a/{y}/{z}': { get: { responses: { '200': ok } } },
      },
    };
    const { loadOpenApiContract } = await import('../../../src/index.js');
    const contract = await loadOpenApiContract({ document });
    const result = contract.validateResponse(response(200, {}, { url: '/a/b/c' }));
    expect(codes(result)).toEqual(['operation.ambiguous']);
  });

  it('applies server prefixes and never guesses one', async () => {
    const contract = await contractFor(
      { '200': ok },
      { servers: [{ url: 'https://api.example.com/api/v1' }] },
    );
    expect(contract.validateResponse(response(200, {}, { url: '/api/v1/thing' })).valid).toBe(true);
    const miss = contract.validateResponse(response(200, {}, { url: '/thing' }));
    expect(codes(miss)).toEqual(['operation.not_found']);
  });

  it('routing.baseUrl joins its path for relative request URLs', async () => {
    const contract = await contractFor(
      { '200': ok },
      {
        servers: [{ url: '/api/v1' }],
        options: { routing: { baseUrl: 'http://localhost:3000/api/v1' } },
      },
    );
    expect(contract.validateResponse(response(200)).valid).toBe(true);
  });
});

describe('status resolution', () => {
  const responses = {
    '200': { description: 'exact' },
    '2XX': { description: 'range' },
    '4XX': { description: 'client error' },
    default: { description: 'other' },
  };

  it.each([
    [200, true],
    [201, true],
    [404, true],
    [500, true],
    [302, true],
  ])('status %i is documented', async (status, valid) => {
    expect((await contractFor(responses)).validateResponse(response(status)).valid).toBe(valid);
  });

  it('reports response.status_not_documented when nothing matches and there is no default', async () => {
    const contract = await contractFor({ '200': ok, '4XX': ok });
    const result = contract.validateResponse(response(500));
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: 'response.status_not_documented',
        status: 500,
        expected: { statuses: ['200', '4XX'] },
      }),
    ]);
    expect(result.operation).toEqual({ method: 'GET', path: '/thing', operationId: 'thing' });
  });

  it('prefers exact over range and range over default for body schemas', async () => {
    const contract = await contractFor({
      '200': {
        description: 'a',
        content: { 'application/json': { schema: { type: 'object', required: ['exact'] } } },
      },
      '2XX': {
        description: 'b',
        content: { 'application/json': { schema: { type: 'object', required: ['range'] } } },
      },
      default: {
        description: 'c',
        content: { 'application/json': { schema: { type: 'object', required: ['fallback'] } } },
      },
    });
    const at = (status: number, body: unknown) =>
      contract.validateResponse(response(status, { headers: json, body })).valid;
    expect(at(200, { exact: 1 })).toBe(true);
    expect(at(200, { range: 1 })).toBe(false);
    expect(at(201, { range: 1 })).toBe(true);
    expect(at(404, { fallback: 1 })).toBe(true);
    expect(at(404, { range: 1 })).toBe(false);
  });
});

describe('input validation', () => {
  it('throws OpenApiInputError for malformed exchanges instead of reporting a contract failure', async () => {
    const contract = await contractFor({ '200': ok });
    const bad = (exchange: unknown) => () => contract.validateResponse(exchange as never);
    expect(bad(null)).toThrow(OpenApiInputError);
    expect(bad({ request: { method: 'GET', url: '/thing' } })).toThrow(OpenApiInputError);
    expect(bad(response(99))).toThrow(OpenApiInputError);
    expect(bad(response(200.5))).toThrow(OpenApiInputError);
    expect(bad(response('200' as never))).toThrow(OpenApiInputError);
    expect(bad({ request: { method: 'GE T', url: '/thing' }, response: { status: 200 } })).toThrow(
      OpenApiInputError,
    );
    expect(bad(response(200, { body: {}, rawBody: '{}' }))).toThrow(
      /either response.body.*or response.rawBody/s,
    );
    expect(bad(response(200, { headers: { a: { nested: true } as never } }))).toThrow(
      OpenApiInputError,
    );
  });
});
