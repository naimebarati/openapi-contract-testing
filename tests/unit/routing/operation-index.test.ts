import { describe, expect, it } from 'vitest';
import { OpenApiSpecError } from '../../../src/index.js';
import type { LookupResult } from '../../../src/routing/operation-index.js';
import { indexFor, ok, oas } from '../../helpers/contracts.js';

const found = (r: LookupResult): string => {
  if (r.kind !== 'found') throw new Error(`expected found, got ${r.kind}: ${JSON.stringify(r)}`);
  return `${r.route.operation.method} ${r.route.operation.path}`;
};

describe('OperationIndex', () => {
  it('matches exact and parameterized paths', async () => {
    const index = await indexFor(
      oas({
        '/users': { get: ok },
        '/users/{userId}': { get: ok },
        '/users/{userId}/orders/{orderId}': { get: ok },
      }),
    );
    expect(found(index.lookup('GET', '/users'))).toBe('GET /users');
    expect(found(index.lookup('GET', '/users/42'))).toBe('GET /users/{userId}');
    expect(found(index.lookup('GET', '/users/42/orders/100'))).toBe(
      'GET /users/{userId}/orders/{orderId}',
    );
  });

  it('prefers static segments over parameters', async () => {
    const index = await indexFor(oas({ '/users/{id}': { get: ok }, '/users/me': { get: ok } }));
    expect(found(index.lookup('GET', '/users/me'))).toBe('GET /users/me');
    expect(found(index.lookup('GET', '/users/mee'))).toBe('GET /users/{id}');
  });

  it('falls back to the templated path when the static path lacks the method', async () => {
    const index = await indexFor(
      oas({ '/users/{id}': { get: ok, delete: ok }, '/users/me': { get: ok } }),
    );
    expect(found(index.lookup('DELETE', '/users/me'))).toBe('DELETE /users/{id}');
  });

  it('does not match a different method and lists the documented ones', async () => {
    const index = await indexFor(oas({ '/users': { get: ok, post: ok } }));
    expect(index.lookup('PUT', '/users')).toMatchObject({
      kind: 'not_found',
      documentedMethods: ['GET', 'POST'],
    });
    expect(index.lookup('GET', '/nope')).toMatchObject({
      kind: 'not_found',
      documentedMethods: [],
    });
  });

  it('is case sensitive for paths and keeps HEAD/OPTIONS separate from GET', async () => {
    const index = await indexFor(oas({ '/Users': { get: ok } }));
    expect(index.lookup('GET', '/users').kind).toBe('not_found');
    expect(index.lookup('HEAD', '/Users').kind).toBe('not_found');
    expect(index.lookup('OPTIONS', '/Users').kind).toBe('not_found');
  });

  it('supports segments that mix literals and parameters', async () => {
    const index = await indexFor(
      oas({ '/files/{name}.{ext}': { get: ok }, '/files/{id}': { get: ok } }),
    );
    expect(found(index.lookup('GET', '/files/report.pdf'))).toBe('GET /files/{name}.{ext}');
    expect(found(index.lookup('GET', '/files/123'))).toBe('GET /files/{id}');
  });

  it('keeps %2F inside one segment and decodes literals', async () => {
    const index = await indexFor(oas({ '/files/{name}': { get: ok }, '/a b': { get: ok } }));
    expect(found(index.lookup('GET', '/files/a%2Fb'))).toBe('GET /files/{name}');
    expect(index.lookup('GET', '/files/a/b').kind).toBe('not_found');
    expect(found(index.lookup('GET', '/a%20b'))).toBe('GET /a b');
  });

  it('reports malformed percent-encoding', async () => {
    const index = await indexFor(oas({ '/files/{name}': { get: ok } }));
    expect(index.lookup('GET', '/files/%zz')).toMatchObject({ kind: 'invalid_path' });
  });

  it('does not match empty parameter segments', async () => {
    const index = await indexFor(oas({ '/users/{id}': { get: ok } }));
    expect(index.lookup('GET', '/users/').kind).toBe('not_found');
    expect(index.lookup('GET', '/users//').kind).toBe('not_found');
  });

  describe('trailing slash', () => {
    const doc = oas({ '/users': { get: ok }, '/users/{id}': { get: ok } });
    it('is strict by default', async () => {
      const index = await indexFor(doc);
      expect(index.lookup('GET', '/users/').kind).toBe('not_found');
      expect(index.lookup('GET', '/users/1/').kind).toBe('not_found');
    });
    it('can be ignored', async () => {
      const index = await indexFor(doc, { trailingSlash: 'ignore' });
      expect(found(index.lookup('GET', '/users/'))).toBe('GET /users');
      expect(found(index.lookup('GET', '/users/1/'))).toBe('GET /users/{id}');
    });
    it('treats /users and /users/ as a collision when ignored', async () => {
      await expect(
        indexFor(oas({ '/users': { get: ok }, '/users/': { get: ok } }), {
          trailingSlash: 'ignore',
        }),
      ).rejects.toThrow(/ambiguous/);
      await indexFor(oas({ '/users': { get: ok }, '/users/': { get: ok } }));
    });
  });

  it('handles the root path', async () => {
    const index = await indexFor(oas({ '/': { get: ok } }));
    expect(found(index.lookup('GET', '/'))).toBe('GET /');
  });

  describe('collisions and ambiguity', () => {
    it('rejects paths that differ only in parameter names at load time', async () => {
      const promise = indexFor(
        oas({ '/users/{id}': { get: ok }, '/users/{name}': { delete: ok } }),
      );
      await expect(promise).rejects.toBeInstanceOf(OpenApiSpecError);
      await expect(promise).rejects.toMatchObject({ issues: [{ code: 'spec.path_collision' }] });
    });

    it('reports incomparable overlapping templates as ambiguous instead of guessing', async () => {
      const index = await indexFor(oas({ '/{x}/b/c': { get: ok }, '/a/{y}/{z}': { get: ok } }));
      const result = index.lookup('GET', '/a/b/c');
      expect(result.kind).toBe('ambiguous');
      expect(found(index.lookup('GET', '/q/b/c'))).toBe('GET /{x}/b/c');
    });

    it('is deterministic when one template is strictly more specific', async () => {
      const index = await indexFor(oas({ '/a/{y}/{z}': { get: ok }, '/a/b/{z}': { get: ok } }));
      expect(found(index.lookup('GET', '/a/b/c'))).toBe('GET /a/b/{z}');
    });
  });

  describe('servers', () => {
    it('applies the root server path prefix and does not match without it', async () => {
      const index = await indexFor(
        oas(
          { '/users/{id}': { get: ok } },
          { servers: [{ url: 'https://api.example.com/api/v1' }] },
        ),
      );
      expect(found(index.lookup('GET', '/api/v1/users/1'))).toBe('GET /users/{id}');
      const miss = index.lookup('GET', '/users/1');
      expect(miss.kind).toBe('not_found');
    });

    it('hints at a prefix mismatch without applying it', async () => {
      const index = await indexFor(oas({ '/users/{id}': { get: ok } }));
      const result = index.lookup('GET', '/api/v1/users/1');
      expect(result).toMatchObject({ kind: 'not_found' });
      expect((result as { hint?: string }).hint).toMatch(/\/api\/v1.*routing\.basePath/);
    });

    it('accepts every root server', async () => {
      const index = await indexFor(
        oas({ '/u': { get: ok } }, { servers: [{ url: '/v1' }, { url: '/v2' }] }),
      );
      expect(found(index.lookup('GET', '/v1/u'))).toBe('GET /u');
      expect(found(index.lookup('GET', '/v2/u'))).toBe('GET /u');
      expect(index.lookup('GET', '/u').kind).toBe('not_found');
    });

    it('lets path item servers replace root servers, and operation servers replace both', async () => {
      const index = await indexFor(
        oas(
          {
            '/a': { get: ok },
            '/b': {
              servers: [{ url: '/pathlevel' }],
              get: ok,
              post: { ...ok, servers: [{ url: '/oplevel' }] },
            },
          },
          { servers: [{ url: '/root' }] },
        ),
      );
      expect(found(index.lookup('GET', '/root/a'))).toBe('GET /a');
      expect(found(index.lookup('GET', '/pathlevel/b'))).toBe('GET /b');
      expect(found(index.lookup('POST', '/oplevel/b'))).toBe('POST /b');
      expect(index.lookup('GET', '/root/b').kind).toBe('not_found');
      expect(index.lookup('POST', '/pathlevel/b').kind).toBe('not_found');
    });

    it('uses server variable defaults and enums in the path', async () => {
      const index = await indexFor(
        oas(
          { '/u': { get: ok } },
          {
            servers: [
              {
                url: 'https://{env}.example.com/{version}',
                variables: {
                  env: { default: 'prod' },
                  version: { default: 'v1', enum: ['v1', 'v2'] },
                },
              },
            ],
          },
        ),
      );
      expect(found(index.lookup('GET', '/v1/u'))).toBe('GET /u');
      expect(found(index.lookup('GET', '/v2/u'))).toBe('GET /u');
      expect(index.lookup('GET', '/v3/u').kind).toBe('not_found');
    });

    it('does not guess: no servers means no prefix', async () => {
      const index = await indexFor(oas({ '/u': { get: ok } }));
      expect(found(index.lookup('GET', '/u'))).toBe('GET /u');
      expect(index.lookup('GET', '/api/u').kind).toBe('not_found');
    });

    it('honors routing.basePath instead of the declared servers', async () => {
      const index = await indexFor(
        oas({ '/u': { get: ok } }, { servers: [{ url: '/declared' }] }),
        { basePath: '/custom/' },
      );
      expect(found(index.lookup('GET', '/custom/u'))).toBe('GET /u');
      expect(index.lookup('GET', '/declared/u').kind).toBe('not_found');
    });
  });
});
