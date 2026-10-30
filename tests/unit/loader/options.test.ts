import { describe, expect, it } from 'vitest';
import { resolveOptions } from '../../../src/contract/contract-options.js';
import { OpenApiConfigError } from '../../../src/index.js';
import type { LoadOpenApiContractOptions } from '../../../src/index.js';

const bad = (options: unknown): void => {
  expect(() => resolveOptions(options as LoadOpenApiContractOptions)).toThrow(OpenApiConfigError);
};

describe('resolveOptions', () => {
  it('requires exactly one input', () => {
    bad({});
    bad({ source: 'a.yaml', document: {} });
    bad({ source: 'a.yaml', content: '{}', contentType: 'json' });
    expect(resolveOptions({ source: 'a.yaml' }).input).toEqual({ kind: 'file', path: 'a.yaml' });
  });

  it('requires contentType with content, and only then', () => {
    bad({ content: '{}' });
    bad({ content: '{}', contentType: 'xml' });
    bad({ source: 'a.yaml', contentType: 'yaml' });
    expect(resolveOptions({ content: '{}', contentType: 'json' }).input.kind).toBe('content');
  });

  it('rejects URL sources and remote references explicitly', () => {
    expect(() => resolveOptions({ source: 'https://example.com/openapi.yaml' })).toThrow(
      /Remote documents are not supported/,
    );
    expect(() => resolveOptions({ source: new URL('https://example.com/o.yaml') })).toThrow(
      /Only local files/,
    );
    expect(() =>
      resolveOptions({ source: 'a.yaml', refs: { allowRemote: true } } as never),
    ).toThrow(/allowRemote.*not supported/);
    expect(resolveOptions({ source: new URL('file:///tmp/o.yaml') }).input).toEqual({
      kind: 'file',
      path: '/tmp/o.yaml',
    });
  });

  it('rejects unknown options instead of ignoring them', () => {
    bad({ source: 'a', extra: 1 });
    bad({ source: 'a', validation: { strict: true } });
    bad({ source: 'a', routing: { prefix: '/api' } });
  });

  it('validates value types', () => {
    bad({ source: 'a', refs: { maxFiles: 0 } });
    bad({ source: 'a', refs: { maxBytesPerFile: 1.5 } });
    bad({ source: 'a', validation: { unsupportedFeaturePolicy: 'ignore' } });
    bad({ source: 'a', validation: { writeOnlyInResponse: 'nope' } });
    bad({ source: 'a', validation: { customFormats: { x: 'not-a-function' } } });
    bad({ source: 'a', routing: { trailingSlash: 'maybe' } });
    bad({ source: 'a', routing: { serverIndex: -1 } });
    bad({ document: [] });
    bad(null);
  });

  it('applies secure defaults', () => {
    const o = resolveOptions({ source: 'a.yaml' });
    expect(o.refs).toEqual({
      rootDir: undefined,
      maxFiles: 1000,
      maxBytesPerFile: 32 * 1024 * 1024,
    });
    expect(o.validation).toMatchObject({
      validateFormats: true,
      maxErrors: 100,
      maxBodyBytes: 10 * 1024 * 1024,
      unsupportedFeaturePolicy: 'error',
      includeActualValues: false,
      writeOnlyInResponse: 'error',
    });
    expect(o.routing.trailingSlash).toBe('strict');
  });
});
