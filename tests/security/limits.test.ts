import { describe, expect, it } from 'vitest';
import { OpenApiConfigError, OpenApiSpecError, loadOpenApiContract } from '../../src/index.js';

function nested(depth: number): Record<string, unknown> {
  let schema: unknown = { type: 'string' };
  for (let i = 0; i < depth; i++) schema = { type: 'object', properties: { a: schema } };
  return {
    openapi: '3.1.0',
    info: { title: 't', version: '1' },
    paths: {
      '/a': {
        get: {
          responses: { 200: { description: 'ok', content: { 'application/json': { schema } } } },
        },
      },
    },
  };
}

describe('pathological documents fail with controlled errors', () => {
  it('loads reasonably nested schemas', async () => {
    const contract = await loadOpenApiContract({ document: nested(100) });
    expect(contract.getOperations()).toHaveLength(1);
  });

  it.each([800, 20_000])('depth %i is reported, not a raw RangeError', async (depth) => {
    const error = await loadOpenApiContract({ document: nested(depth) }).catch((e: unknown) => e);
    expect(error instanceof OpenApiSpecError || error instanceof OpenApiConfigError).toBe(true);
    expect(error).not.toBeInstanceOf(RangeError);
    expect((error as Error).message).toMatch(/nested too deeply/);
  });

  it('rejects oversized YAML content', async () => {
    await expect(
      loadOpenApiContract({
        content: `openapi: 3.1.0\n${'#'.repeat(2000)}\n`,
        contentType: 'yaml',
        refs: { maxBytesPerFile: 1000 },
      }),
    ).rejects.toBeInstanceOf(OpenApiConfigError);
  });

  it('rejects a YAML alias bomb without exhausting memory', async () => {
    let yaml = 'openapi: 3.1.0\nx-a0: &a0 [x, x, x, x, x, x, x, x, x, x]\n';
    for (let i = 1; i < 12; i++)
      yaml += `x-a${i}: &a${i} [${Array<string>(10)
        .fill(`*a${i - 1}`)
        .join(', ')}]\n`;
    await expect(
      loadOpenApiContract({ content: yaml, contentType: 'yaml' }),
    ).rejects.toBeInstanceOf(OpenApiSpecError);
  });
});
