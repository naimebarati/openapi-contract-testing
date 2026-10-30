import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { OpenApiContractAssertionError, loadOpenApiContract } from '../../src/index.js';
import type { HttpExchange, OpenApiContract } from '../../src/index.js';

export const referenceSpec = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/app/openapi.yaml',
);

/**
 * Faults a reference server can be asked to produce with `?fault=<name>`. Every framework implements
 * them natively so the integration tests exercise real responses, not hand-made objects.
 */
export type Fault =
  'status' | 'content-type' | 'header' | 'property' | 'json' | 'not-found' | 'multi';

export const USER = { id: '123', email: 'ada@example.com', nickname: null };

/**
 * Registers the contract expectations shared by every integration: `exchange(fault)` must perform a real
 * HTTP request against the framework under test and adapt the response.
 */
export function defineReferenceSuite(
  name: string,
  exchange: (fault?: Fault) => Promise<HttpExchange>,
  { spec = referenceSpec }: { spec?: string | (() => Record<string, unknown>) } = {},
): void {
  describe(`${name} integration`, () => {
    let contract: OpenApiContract;
    beforeAll(async () => {
      contract = await loadOpenApiContract(
        typeof spec === 'string' ? { source: spec } : { document: spec() },
      );
    });

    it('accepts a conforming response', async () => {
      const result = contract.validateResponse(await exchange());
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
      expect(result.operation).toMatchObject({ method: 'GET', operationId: 'getUser' });
    });

    it('accepts a documented error response', async () => {
      const result = contract.validateResponse(await exchange('not-found'));
      expect(result.errors).toEqual([]);
      expect(result.operation?.operationId).toBe('getUser');
    });

    it.each<[Fault, string]>([
      ['status', 'response.status_not_documented'],
      ['content-type', 'response.content_type_unexpected'],
      ['header', 'response.header_missing'],
      ['property', 'response.body.schema_invalid'],
      ['json', 'response.body.invalid_json'],
    ])('reports %s as its own diagnostic', async (fault, code) => {
      const result = contract.validateResponse(await exchange(fault));
      expect(result.valid).toBe(false);
      expect(result.errors.map((e) => e.code)).toEqual([code]);
    });

    it('points at the wrong property', async () => {
      const result = contract.validateResponse(await exchange('property'));
      expect(result.errors[0]).toMatchObject({
        instancePath: '/email',
        keyword: 'type',
        operationId: 'getUser',
        status: 200,
      });
    });

    it('reports several independent problems of one response together', async () => {
      const result = contract.validateResponse(await exchange('multi'));
      expect(result.errors.map((e) => e.code)).toEqual([
        'response.header_missing',
        'response.body.schema_invalid',
      ]);
    });

    it('assertResponse throws a readable error carrying the structured result', async () => {
      const bad = await exchange('multi');
      let error: unknown;
      try {
        contract.assertResponse(bad);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(OpenApiContractAssertionError);
      expect((error as OpenApiContractAssertionError).message).toContain('Header: X-Request-Id');
      expect((error as OpenApiContractAssertionError).message).toContain('Path: $.email');
      expect((error as OpenApiContractAssertionError).result.errors).toHaveLength(2);
    });
  });
}
