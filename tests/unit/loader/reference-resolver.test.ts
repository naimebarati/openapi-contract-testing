import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OpenApiSpecError } from '../../../src/index.js';
import { ReferenceResolver } from '../../../src/loader/reference-resolver.js';

const refsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/refs');

const doc = {
  paths: { '/users/{id}': { get: { ok: true } } },
  components: {
    schemas: { User: { type: 'object' }, 'a/b': { type: 'string' }, 'a~b': { type: 'integer' } },
  },
  list: ['zero', 'one'],
};

async function memoryResolver(): Promise<ReferenceResolver> {
  const resolver = new ReferenceResolver(
    { rootDir: undefined, maxFiles: 5, maxBytesPerFile: 1024 },
    { key: '<doc>', data: doc, dir: undefined },
  );
  await resolver.init();
  return resolver;
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as OpenApiSpecError).issues[0]?.code;
  }
  return undefined;
}

describe('ReferenceResolver: local references', () => {
  it('resolves JSON pointers, escapes and percent-encoding', async () => {
    const r = await memoryResolver();
    const get = async (ref: string) => r.get(await r.resolve('<doc>', ref));
    expect(await get('#/components/schemas/User')).toEqual({ type: 'object' });
    expect(await get('#/components/schemas/a~1b')).toEqual({ type: 'string' });
    expect(await get('#/components/schemas/a~0b')).toEqual({ type: 'integer' });
    expect(await get('#/paths/~1users~1%7Bid%7D/get')).toEqual({ ok: true });
    expect(await get('#/list/1')).toBe('one');
    expect(await get('#')).toBe(doc);
  });

  it('reports missing targets as reference.not_found', async () => {
    const r = await memoryResolver();
    for (const ref of ['#/components/schemas/Nope', '#/list/2', '#/list/01', '#/list/x']) {
      const location = await r.resolve('<doc>', ref);
      expect(() => r.get(location)).toThrow(OpenApiSpecError);
      try {
        r.get(location);
      } catch (error) {
        expect((error as OpenApiSpecError).issues[0]?.code).toBe('reference.not_found');
      }
    }
  });

  it('never resolves inherited properties', async () => {
    const r = await memoryResolver();
    for (const ref of [
      '#/__proto__',
      '#/constructor',
      '#/components/schemas/toString',
      '#/list/length',
    ]) {
      expect(() => r.get({ docKey: '<doc>', pointer: ref.slice(1) })).toThrow(/does not exist/);
    }
  });

  it('rejects malformed percent-encoding and anchors', async () => {
    const r = await memoryResolver();
    expect(await codeOf(r.resolve('<doc>', '#/a%zz'))).toBe('reference.not_found');
    expect(await codeOf(r.resolve('<doc>', '#anchor'))).toBe('spec.unsupported_feature');
  });
});

describe('ReferenceResolver: file references', () => {
  async function fileResolver(
    overrides: Partial<ConstructorParameters<typeof ReferenceResolver>[0]> = {},
  ) {
    const rootKey = path.join(refsDir, 'openapi.yaml');
    const resolver = new ReferenceResolver(
      { rootDir: refsDir, maxFiles: 10, maxBytesPerFile: 1024 * 1024, ...overrides },
      { key: rootKey, data: {}, dir: refsDir },
    );
    await resolver.init();
    return { resolver, rootKey };
  }

  it('resolves relative files, fragments, and refs relative to the referencing file', async () => {
    const { resolver, rootKey } = await fileResolver();
    const user = await resolver.resolve(rootKey, './schemas/user.yaml');
    expect(resolver.get(user)).toMatchObject({ type: 'object' });
    const address = await resolver.resolve(user.docKey, './address.yaml#/definitions/Address');
    expect(resolver.get(address)).toMatchObject({ properties: { street: { type: 'string' } } });
  });

  it('loads each file once, even with circular references and different spellings', async () => {
    const { resolver, rootKey } = await fileResolver();
    const a = await resolver.resolve(rootKey, './schemas/user.yaml');
    const b = await resolver.resolve(a.docKey, './user.yaml');
    const c = await resolver.resolve(rootKey, './schemas/../schemas/./user.yaml');
    expect(b.docKey).toBe(a.docKey);
    expect(c.docKey).toBe(a.docKey);
    expect(resolver.fileCount).toBe(2);
  });

  it('reports missing files inside the root as reference.not_found', async () => {
    const { resolver, rootKey } = await fileResolver();
    expect(await codeOf(resolver.resolve(rootKey, './schemas/missing.yaml'))).toBe(
      'reference.not_found',
    );
  });

  it('refuses file references when no root directory is configured', async () => {
    const resolver = new ReferenceResolver(
      { rootDir: undefined, maxFiles: 5, maxBytesPerFile: 1024 },
      { key: '<doc>', data: {}, dir: undefined },
    );
    await resolver.init();
    expect(await codeOf(resolver.resolve('<doc>', './a.yaml'))).toBe('reference.not_allowed');
  });

  it('enforces maxFiles and maxBytesPerFile', async () => {
    const limited = await fileResolver({ maxFiles: 2 });
    await limited.resolver.resolve(limited.rootKey, './schemas/user.yaml');
    expect(await codeOf(limited.resolver.resolve(limited.rootKey, './schemas/address.yaml'))).toBe(
      'reference.not_allowed',
    );

    const small = await fileResolver({ maxBytesPerFile: 20 });
    expect(await codeOf(small.resolver.resolve(small.rootKey, './schemas/user.yaml'))).toBe(
      'reference.not_allowed',
    );
  });

  it('refuses directories and non-regular targets', async () => {
    const { resolver, rootKey } = await fileResolver();
    expect(await codeOf(resolver.resolve(rootKey, './schemas'))).toBe('reference.not_allowed');
  });
});
