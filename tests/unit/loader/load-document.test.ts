import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveOptions } from '../../../src/contract/contract-options.js';
import { OpenApiConfigError, OpenApiSpecError } from '../../../src/index.js';
import type { LoadOpenApiContractOptions } from '../../../src/index.js';
import { loadDocument } from '../../../src/loader/load-document.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures');
const load = (options: LoadOpenApiContractOptions) => loadDocument(resolveOptions(options));
const fixture = (...parts: string[]) => path.join(fixtures, ...parts);

async function specError(options: LoadOpenApiContractOptions): Promise<OpenApiSpecError> {
  try {
    await load(options);
  } catch (error) {
    expect(error).toBeInstanceOf(OpenApiSpecError);
    return error as OpenApiSpecError;
  }
  throw new Error('expected loadDocument to throw');
}

describe('loadDocument: valid documents', () => {
  it.each([
    ['openapi-3.0/users.yaml', '3.0', '3.0.3'],
    ['openapi-3.1/users.yaml', '3.1', '3.1.1'],
    ['openapi-3.1/users.json', '3.1', '3.1.0'],
    ['openapi-3.2/users.yaml', '3.2', '3.2.0'],
  ])('loads %s', async (file, version, openapi) => {
    const doc = await load({ source: fixture(file) });
    expect(doc.version).toBe(version);
    expect(doc.openapi).toBe(openapi);
    expect(doc.file).toBeDefined();
  });

  it('loads raw YAML and JSON content and parsed objects', async () => {
    const yamlText = readFileSync(fixture('openapi-3.1/users.yaml'), 'utf8');
    expect((await load({ content: yamlText, contentType: 'yaml' })).version).toBe('3.1');
    const jsonText = readFileSync(fixture('openapi-3.1/users.json'), 'utf8');
    expect((await load({ content: jsonText, contentType: 'json' })).version).toBe('3.1');
    const document = JSON.parse(jsonText) as Record<string, unknown>;
    expect((await load({ document })).version).toBe('3.1');
  });

  it('accepts a file: URL source', async () => {
    const url = new URL(`file://${fixture('openapi-3.0/users.yaml')}`);
    expect((await load({ source: url })).version).toBe('3.0');
  });

  it('does not mutate the user document and is isolated from later changes to it', async () => {
    const document = JSON.parse(readFileSync(fixture('openapi-3.1/users.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    const before = structuredClone(document);
    const doc = await load({ document });
    expect(document).toEqual(before);
    (document['info'] as Record<string, unknown>)['title'] = 'changed after load';
    expect((doc.root['info'] as Record<string, unknown>)['title']).toBe('Users');
  });

  it('accepts a 3.1 document that only has webhooks', async () => {
    const doc = await load({
      document: { openapi: '3.1.0', info: { title: 'w', version: '1' }, webhooks: {} },
    });
    expect(doc.version).toBe('3.1');
  });
});

describe('loadDocument: invalid documents', () => {
  it('reports a missing info.version with its location', async () => {
    const error = await specError({ source: fixture('invalid-specs/missing-info-version.yaml') });
    expect(error.issues[0]).toMatchObject({ code: 'spec.invalid', instancePath: '/info' });
    expect(error.message).toContain("must have required property 'version'");
  });

  it('reports YAML and JSON syntax errors as spec.invalid', async () => {
    expect(
      (await specError({ source: fixture('invalid-specs/bad-syntax.yaml') })).issues[0]?.code,
    ).toBe('spec.invalid');
    expect((await specError({ source: fixture('invalid-specs/truncated.json') })).message).toMatch(
      /invalid JSON/,
    );
  });

  it('rejects Swagger 2.0, unknown versions and non-object roots with clear messages', async () => {
    expect((await specError({ source: fixture('invalid-specs/swagger2.yaml') })).message).toMatch(
      /2\.0.*not supported/,
    );
    expect(
      (await specError({ source: fixture('invalid-specs/unknown-version.yaml') })).message,
    ).toMatch(/Unsupported OpenAPI version "4\.0\.0"/);
    expect((await specError({ source: fixture('invalid-specs/array-root.yaml') })).message).toMatch(
      /must be an object/,
    );
  });

  it('requires paths in OpenAPI 3.0', async () => {
    const error = await specError({ source: fixture('invalid-specs/no-paths-3.0.yaml') });
    expect(error.message).toMatch(/paths/);
  });

  it('reports wrong value types inside operations (3.0 and 3.1)', async () => {
    for (const openapi of ['3.0.3', '3.1.0']) {
      const error = await specError({
        document: {
          openapi,
          info: { title: 't', version: '1' },
          paths: { '/a': { get: { responses: { '200': { description: 5 } } } } },
        },
      });
      expect(
        error.issues.some((i) => i.instancePath === '/paths/~1a/get/responses/200/description'),
      ).toBe(true);
    }
  });

  it('limits the number of reported structural errors', async () => {
    const paths: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++)
      paths[`/p${i}`] = { get: { responses: { '200': { description: i } } } };
    const error = await specError({
      document: { openapi: '3.0.3', info: { title: 't', version: '1' }, paths },
      validation: { maxErrors: 3 },
    });
    expect(error.issues).toHaveLength(3);
  });

  it('reports errors in a deterministic order', async () => {
    const document = { openapi: '3.0.3', info: { title: 1, version: 2 }, paths: {} };
    const a = await specError({ document });
    const b = await specError({ document });
    expect(a.issues).toEqual(b.issues);
  });

  it('throws OpenApiConfigError for unusable input', async () => {
    await expect(load({ source: fixture('does-not-exist.yaml') })).rejects.toBeInstanceOf(
      OpenApiConfigError,
    );
    await expect(load({ document: { openapi: '3.1.0', fn: () => 1 } })).rejects.toBeInstanceOf(
      OpenApiConfigError,
    );
    await expect(
      load({ source: fixture('openapi-3.0/users.yaml'), refs: { maxBytesPerFile: 10 } }),
    ).rejects.toBeInstanceOf(OpenApiConfigError);
    await expect(
      load({
        source: fixture('openapi-3.0/users.yaml'),
        refs: { rootDir: fixture('openapi-3.1') },
      }),
    ).rejects.toBeInstanceOf(OpenApiConfigError);
  });
});

describe('loadDocument: unsupported document features', () => {
  const base = { openapi: '3.1.0', info: { title: 't', version: '1' }, paths: {} };

  it('reports a custom jsonSchemaDialect instead of ignoring it', async () => {
    const doc = await load({
      document: { ...base, jsonSchemaDialect: 'https://example.com/my-dialect' },
    });
    expect(doc.diagnostics.count).toBe(1);
    expect(() => doc.diagnostics.finalize('error')).toThrow(/jsonSchemaDialect/);
    const warnings = doc.diagnostics.finalize('warning');
    expect(warnings[0]).toMatchObject({ code: 'spec.unsupported_feature', severity: 'warning' });
  });

  it('accepts the OAS dialects and JSON Schema 2020-12', async () => {
    for (const jsonSchemaDialect of [
      'https://spec.openapis.org/oas/3.1/dialect/base',
      'https://spec.openapis.org/oas/3.1/dialect/2024-11-10',
      'https://json-schema.org/draft/2020-12/schema',
    ]) {
      expect((await load({ document: { ...base, jsonSchemaDialect } })).diagnostics.count).toBe(0);
    }
  });

  it('reports $self in OpenAPI 3.2', async () => {
    const doc = await load({
      document: { ...base, openapi: '3.2.0', $self: 'https://example.com/api/openapi.yaml' },
    });
    expect(doc.diagnostics.finalize('warning')[0]?.message).toMatch(/\$self/);
  });
});
