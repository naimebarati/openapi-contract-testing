import { describe, expect, it } from 'vitest';
import { loadOpenApiContract } from '../../../src/index.js';
import { oas } from '../../helpers/contracts.js';
import { codes, contractFor, response } from '../../helpers/exchanges.js';

const withHeaders = (headers: Record<string, unknown>, options = {}) =>
  contractFor({ '200': { description: 'ok', headers } }, { options });

describe('response headers', () => {
  it('reports a missing required header and accepts a missing optional one', async () => {
    const contract = await withHeaders({
      'X-Request-Id': { required: true, schema: { type: 'string' } },
      'X-Optional': { schema: { type: 'string' } },
    });
    const result = contract.validateResponse(response(200));
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: 'response.header_missing',
        header: 'X-Request-Id',
        status: 200,
      }),
    ]);
    expect(
      contract.validateResponse(response(200, { headers: { 'x-request-id': 'abc' } })).valid,
    ).toBe(true);
  });

  it('matches header names case-insensitively in every supported header shape', async () => {
    const contract = await withHeaders({
      'X-Request-Id': { required: true, schema: { type: 'string' } },
    });
    for (const headers of [
      { 'X-REQUEST-ID': 'a' },
      new Headers({ 'x-request-id': 'a' }),
      [['x-Request-ID', 'a']] as [string, string][],
      new Map([['x-request-id', 'a']]),
    ]) {
      expect(contract.validateResponse(response(200, { headers })).valid).toBe(true);
    }
  });

  it('validates scalar types strictly (no coercion)', async () => {
    const contract = await withHeaders({
      'X-Count': { schema: { type: 'integer', minimum: 0, maximum: 10 } },
      'X-Ratio': { schema: { type: 'number' } },
      'X-Flag': { schema: { type: 'boolean' } },
      'X-Mode': { schema: { type: 'string', enum: ['a', 'b'] } },
    });
    const at = (headers: Record<string, string | number | undefined>) =>
      contract.validateResponse(response(200, { headers }));
    expect(at({ 'X-Count': '5', 'X-Ratio': '1.5e3', 'X-Flag': 'true', 'X-Mode': 'a' }).valid).toBe(
      true,
    );
    expect(at({ 'X-Count': 5 }).valid).toBe(true);
    for (const headers of [
      { 'X-Count': '' },
      { 'X-Count': '5.5' },
      { 'X-Count': '0x10' },
      { 'X-Count': ' 5' },
      { 'X-Count': '11' },
      { 'X-Count': '-1' },
      { 'X-Ratio': 'NaN' },
      { 'X-Flag': 'yes' },
      { 'X-Flag': 'TRUE' },
      { 'X-Mode': 'c' },
    ]) {
      const result = at(headers);
      expect(codes(result), JSON.stringify(headers)).toEqual(['response.header_invalid']);
      expect(result.errors[0]?.header).toBe(Object.keys(headers)[0]);
    }
  });

  it('validates formats and patterns of header values', async () => {
    const contract = await withHeaders({
      'X-Id': { schema: { type: 'string', format: 'uuid' } },
      'X-Code': { schema: { type: 'string', pattern: '^[A-Z]{3}$' } },
    });
    expect(
      contract.validateResponse(
        response(200, {
          headers: { 'X-Id': '3f2504e0-4f89-41d3-9a0c-0305e82c3301', 'X-Code': 'ABC' },
        }),
      ).valid,
    ).toBe(true);
    expect(
      codes(
        contract.validateResponse(response(200, { headers: { 'X-Id': 'nope', 'X-Code': 'abc' } })),
      ),
    ).toEqual(['response.header_invalid', 'response.header_invalid']);
  });

  it('validates arrays of primitives using the simple style', async () => {
    const contract = await withHeaders({
      'X-Ids': { schema: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 3 } },
    });
    const at = (value: string | string[]) =>
      contract.validateResponse(response(200, { headers: { 'X-Ids': value } }));
    expect(at('1, 2,3').valid).toBe(true);
    expect(at(['1', '2']).valid).toBe(true);
    expect(codes(at('1,x'))).toEqual(['response.header_invalid']);
    expect(codes(at('1,2,3,4'))).toEqual(['response.header_invalid']);
    expect(codes(at(''))).toEqual(['response.header_invalid']);
  });

  it('keeps Set-Cookie values separate instead of joining them with commas', async () => {
    const contract = await withHeaders({
      'Set-Cookie': {
        required: true,
        schema: { type: 'string', pattern: '^[a-z]+=[a-z0-9]+(; .+)?$' },
      },
    });
    const good = contract.validateResponse(
      response(200, { headers: { 'set-cookie': ['a=1; Path=/', 'b=2; HttpOnly'] } }),
    );
    expect(good.valid).toBe(true);
    const bad = contract.validateResponse(
      response(200, { headers: { 'set-cookie': ['a=1', 'B=BAD'] } }),
    );
    expect(bad.errors).toHaveLength(1);
    // A comma inside an Expires attribute must not split or join anything.
    expect(
      contract.validateResponse(
        response(200, { headers: { 'set-cookie': 'a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT' } }),
      ).valid,
    ).toBe(true);
  });

  it('joins repeated non-cookie header lines with ", " as HTTP specifies', async () => {
    const contract = await withHeaders({
      'X-List': { schema: { type: 'string', pattern: '^a, b$' } },
    });
    expect(
      contract.validateResponse(
        response(200, {
          headers: [
            ['x-list', 'a'],
            ['x-list', 'b'],
          ],
        }),
      ).valid,
    ).toBe(true);
  });

  it('ignores headers that are not in the contract and the Content-Type definition', async () => {
    const contract = await withHeaders({
      'Content-Type': { required: true, schema: { type: 'string', pattern: '^never$' } },
    });
    expect(
      contract.validateResponse(response(200, { headers: { 'X-Unknown': 'whatever' } })).valid,
    ).toBe(true);
  });

  it('resolves header $refs and works for OpenAPI 3.0', async () => {
    const contract = await contractFor(
      {
        '200': { description: 'ok', headers: { 'X-Rate': { $ref: '#/components/headers/Rate' } } },
      },
      {
        openapi: '3.0.3',
        components: {
          headers: {
            Rate: {
              required: true,
              schema: { type: 'integer', minimum: 1, exclusiveMinimum: true },
            },
          },
        },
      },
    );
    expect(contract.validateResponse(response(200, { headers: { 'x-rate': '2' } })).valid).toBe(
      true,
    );
    expect(codes(contract.validateResponse(response(200, { headers: { 'x-rate': '1' } })))).toEqual(
      ['response.header_invalid'],
    );
    expect(codes(contract.validateResponse(response(200)))).toEqual(['response.header_missing']);
  });

  it('only checks presence for header schemas it cannot convert, and reports them at load', async () => {
    const options = { validation: { unsupportedFeaturePolicy: 'warning' as const } };
    const contract = await withHeaders(
      { 'X-Obj': { required: true, schema: { type: 'object' } } },
      options,
    );
    expect(
      contract
        .getWarnings()
        .some((w) => w.code === 'spec.unsupported_feature' && w.message.includes('X-Obj')),
    ).toBe(true);
    expect(
      contract.validateResponse(response(200, { headers: { 'x-obj': 'anything' } })).valid,
    ).toBe(true);
    expect(codes(contract.validateResponse(response(200)))).toEqual(['response.header_missing']);
    await expect(withHeaders({ 'X-Obj': { schema: { type: 'object' } } })).rejects.toThrow(/X-Obj/);
  });

  it('never prints header values unless asked, and keeps sensitive ones redacted even then', async () => {
    const declared = {
      'X-Count': { schema: { type: 'integer' } },
      'X-Token-Id': { schema: { type: 'integer' } },
      'X-Api-Key': { schema: { type: 'integer' } },
    };
    const sent = {
      'X-Count': 'visible-text',
      'X-Token-Id': 'secret-value-1',
      'X-Api-Key': 'secret-value-2',
    };

    const quiet = await withHeaders(declared);
    const result = quiet.validateResponse(response(200, { headers: sent }));
    expect(result.errors).toHaveLength(3);
    expect(JSON.stringify(result)).not.toMatch(/secret-value|visible-text/);

    const loud = await withHeaders(declared, { validation: { includeActualValues: true } });
    const shown = loud.validateResponse(response(200, { headers: sent }));
    const actual = (name: string) => shown.errors.find((e) => e.header === name)?.actual;
    expect(actual('X-Count')).toBe('visible-text');
    expect(actual('X-Token-Id')).toBe('[redacted]');
    expect(actual('X-Api-Key')).toBe('[redacted]');
    expect(JSON.stringify(shown)).not.toContain('secret-value');
  });

  it('is reported deterministically in contract order alongside other issues', async () => {
    const contract = await withHeaders({
      B: { required: true, schema: { type: 'string' } },
      A: { required: true, schema: { type: 'string' } },
    });
    expect(contract.validateResponse(response(200)).errors.map((e) => e.header)).toEqual([
      'B',
      'A',
    ]);
  });

  it('works with a document loaded from a different instance (no shared state)', async () => {
    const first = await loadOpenApiContract({
      document: oas({
        '/a': {
          get: {
            responses: {
              '200': {
                description: 'x',
                headers: { A: { required: true, schema: { type: 'string' } } },
              },
            },
          },
        },
      }),
    });
    const second = await loadOpenApiContract({
      document: oas({ '/a': { get: { responses: { '200': { description: 'x' } } } } }),
    });
    expect(first.validateResponse(response(200, {}, { url: '/a' })).valid).toBe(false);
    expect(second.validateResponse(response(200, {}, { url: '/a' })).valid).toBe(true);
  });
});
