import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OpenApiConfigError, OpenApiSpecError } from '../../../src/index.js';
import { selectResponse } from '../../../src/routing/select-response.js';
import { fixture, normalized, ok, oas } from '../../helpers/contracts.js';

describe('normalizeDocument: fixtures', () => {
  it.each([
    ['openapi-3.0/users.yaml', '3.0'],
    ['openapi-3.1/users.yaml', '3.1'],
    ['openapi-3.2/users.yaml', '3.2'],
  ])('builds the model for %s', async (file, version) => {
    const { model } = await normalized({ source: fixture(file) });
    expect(model.version).toBe(version);
    expect(model.operations).toHaveLength(1);
    const op = model.operations[0]!;
    expect(op).toMatchObject({
      method: 'GET',
      path: '/users/{id}',
      operationId: 'getUser',
      prefixes: ['/api/v1'],
    });
    expect(op.responses.keys).toEqual(['200', '404']);
    expect(op.responses.exact.get(200)?.headers.map((h) => [h.name, h.required])).toEqual([
      ['X-Request-Id', true],
    ]);
    expect(op.responses.exact.get(200)?.content[0]).toMatchObject({
      key: 'application/json',
      schema: {
        loc: { pointer: '/paths/~1users~1{id}/get/responses/200/content/application~1json/schema' },
      },
    });
  });
});

describe('normalizeDocument: references outside schemas', () => {
  it('resolves response, header, media type and path item references', async () => {
    const { model } = await normalized({
      document: oas(
        {
          '/a': { $ref: '#/components/pathItems/A' },
        },
        {
          components: {
            pathItems: {
              A: {
                get: {
                  operationId: 'a',
                  responses: { '200': { $ref: '#/components/responses/R' } },
                },
              },
            },
            responses: {
              R: {
                description: 'r',
                headers: { 'X-Rate': { $ref: '#/components/headers/Rate' } },
                content: { 'application/json': { schema: { type: 'string' } } },
              },
            },
            headers: { Rate: { required: true, schema: { type: 'integer' } } },
          },
        },
      ),
    });
    const response = model.operations[0]!.responses.exact.get(200)!;
    expect(response.headers[0]).toMatchObject({ name: 'X-Rate', required: true });
    expect(response.headers[0]!.schema?.loc.pointer).toBe('/components/headers/Rate/schema');
    expect(response.loc.pointer).toBe('/components/responses/R');
  });

  it('fails the load for broken references with reference.not_found', async () => {
    const promise = normalized({
      document: oas({
        '/a': { get: { responses: { '200': { $ref: '#/components/responses/Missing' } } } },
      }),
    });
    await expect(promise).rejects.toMatchObject({ issues: [{ code: 'reference.not_found' }] });
  });

  it('detects circular reference chains', async () => {
    const promise = normalized({
      document: oas(
        { '/a': { get: { responses: { '200': { $ref: '#/components/responses/A' } } } } },
        {
          components: {
            responses: {
              A: { $ref: '#/components/responses/B' },
              B: { $ref: '#/components/responses/A' },
            },
          },
        },
      ),
    });
    await expect(promise).rejects.toThrow(/Circular reference chain/);
  });

  it('resolves external files relative to the referencing file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'oct-norm-'));
    try {
      await mkdir(path.join(dir, 'parts'));
      await writeFile(
        path.join(dir, 'parts', 'response.yaml'),
        "description: ok\ncontent:\n  application/json:\n    schema: {$ref: './schema.yaml'}\n",
      );
      await writeFile(path.join(dir, 'parts', 'schema.yaml'), 'type: string\n');
      await writeFile(
        path.join(dir, 'openapi.yaml'),
        "openapi: 3.1.0\ninfo: {title: t, version: '1'}\npaths:\n  /a:\n    get:\n      responses:\n        '200': {$ref: './parts/response.yaml'}\n",
      );
      const { model } = await normalized({ source: path.join(dir, 'openapi.yaml') });
      const media = model.operations[0]!.responses.exact.get(200)!.content[0]!;
      expect(media.schema?.loc.docKey.endsWith(path.join('parts', 'response.yaml'))).toBe(true);
      expect(media.schema?.loc.pointer).toBe('/content/application~1json/schema');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('normalizeDocument: responses', () => {
  it('indexes exact, range and default responses', async () => {
    const { model } = await normalized({
      document: oas({
        '/a': {
          get: {
            responses: {
              '200': { description: 'a' },
              '2XX': { description: 'b' },
              '4XX': { description: 'c' },
              default: { description: 'd' },
            },
          },
        },
      }),
    });
    const r = model.operations[0]!.responses;
    expect([...r.exact.keys()]).toEqual([200]);
    expect([...r.ranges.keys()]).toEqual([2, 4]);
    expect(r.default?.key).toBe('default');
  });

  it('follows exact > range > default precedence', async () => {
    const { model } = await normalized({
      document: oas({
        '/a': {
          get: {
            responses: {
              '200': { description: 'exact' },
              '2XX': { description: 'range' },
              '4XX': { description: 'client' },
              default: { description: 'fallback' },
            },
          },
        },
      }),
    });
    const r = model.operations[0]!.responses;
    expect(selectResponse(r, 200)?.key).toBe('200');
    expect(selectResponse(r, 201)?.key).toBe('2XX');
    expect(selectResponse(r, 404)?.key).toBe('4XX');
    expect(selectResponse(r, 500)?.key).toBe('default');
    expect(selectResponse(r, 100)?.key).toBe('default');
  });

  it('returns nothing when no response matches and there is no default', async () => {
    const { model } = await normalized({
      document: oas({ '/a': { get: { responses: { '200': { description: 'x' } } } } }),
    });
    expect(selectResponse(model.operations[0]!.responses, 404)).toBeUndefined();
  });

  it('ignores a Content-Type response header definition (handled by media types)', async () => {
    const { model } = await normalized({
      document: oas({
        '/a': {
          get: {
            responses: {
              '200': {
                description: 'x',
                headers: {
                  'Content-Type': { schema: { type: 'string' } },
                  'X-A': { schema: { type: 'string' } },
                },
              },
            },
          },
        },
      }),
    });
    expect(model.operations[0]!.responses.exact.get(200)!.headers.map((h) => h.name)).toEqual([
      'X-A',
    ]);
  });
});

describe('normalizeDocument: methods', () => {
  it('keeps HEAD, OPTIONS and TRACE as their own operations', async () => {
    const { model } = await normalized({
      document: oas({ '/a': { get: ok, head: ok, options: ok, trace: ok } }),
    });
    expect(model.operations.map((o) => o.method).sort()).toEqual([
      'GET',
      'HEAD',
      'OPTIONS',
      'TRACE',
    ]);
  });

  it('supports QUERY and additionalOperations in OpenAPI 3.2 and rejects QUERY in 3.1', async () => {
    const doc32 = oas(
      { '/search': { query: ok, additionalOperations: { LINK: ok } } },
      {},
      '3.2.0',
    );
    const { model, index } = await normalized({ document: doc32 });
    expect(model.operations.map((o) => o.method).sort()).toEqual(['LINK', 'QUERY']);
    expect(index.lookup('QUERY', '/search').kind).toBe('found');
    expect(index.lookup('GET', '/search').kind).toBe('not_found');
    await expect(
      normalized({ document: oas({ '/search': { query: ok } }) }),
    ).rejects.toBeInstanceOf(OpenApiSpecError);
  });
});

describe('normalizeDocument: diagnostics', () => {
  it('warns about duplicate operationIds', async () => {
    const { diagnostics } = await normalized({
      document: oas({
        '/a': { get: { ...ok, operationId: 'dup' } },
        '/b': { get: { ...ok, operationId: 'dup' } },
      }),
    });
    const warnings = diagnostics.finalize('error');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ severity: 'warning', operationId: 'dup' });
  });

  it('reports headers defined with content and itemSchema media types as unsupported', async () => {
    const { diagnostics } = await normalized({
      document: oas(
        {
          '/a': {
            get: {
              responses: {
                '200': {
                  description: 'x',
                  headers: {
                    'X-A': { content: { 'application/json': { schema: { type: 'string' } } } },
                  },
                  content: { 'application/jsonl': { itemSchema: { type: 'object' } } },
                },
              },
            },
          },
        },
        {},
        '3.2.0',
      ),
    });
    expect(() => diagnostics.finalize('error')).toThrow(/content.*not supported|itemSchema/s);
    const messages = diagnostics.finalize('warning').map((i) => i.message);
    expect(messages.some((m) => m.includes('"X-A"') && m.includes('"content"'))).toBe(true);
    expect(messages.some((m) => m.includes('itemSchema'))).toBe(true);
  });

  it('rejects server variables without a default', async () => {
    await expect(
      normalized({ document: oas({ '/a': { get: ok } }, { servers: [{ url: '/{v}' }] }) }),
    ).rejects.toThrow(/Server variable/);
  });

  it('rejects invalid response keys that the structure check does not catch in extensions', async () => {
    await expect(
      normalized({
        document: oas({ '/a': { get: { responses: { '99': { description: 'x' } } } } }),
      }),
    ).rejects.toBeInstanceOf(OpenApiSpecError);
  });
});

describe('normalizeDocument: routing options', () => {
  const doc = oas({ '/a': { get: ok } }, { servers: [{ url: '/one' }, { url: '/two' }] });

  it('serverIndex selects one root server', async () => {
    const { index } = await normalized({ document: doc, routing: { serverIndex: 1 } });
    expect(index.lookup('GET', '/two/a').kind).toBe('found');
    expect(index.lookup('GET', '/one/a').kind).toBe('not_found');
  });

  it('rejects an out-of-range serverIndex and conflicting options', async () => {
    await expect(normalized({ document: doc, routing: { serverIndex: 5 } })).rejects.toBeInstanceOf(
      OpenApiConfigError,
    );
    await expect(
      normalized({ document: doc, routing: { serverIndex: 0, basePath: '/x' } }),
    ).rejects.toBeInstanceOf(OpenApiConfigError);
  });
});
