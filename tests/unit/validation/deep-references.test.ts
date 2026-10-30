import { describe, expect, it } from 'vitest';
import { accepts, compileSchema, rejects } from '../../helpers/schemas.js';
import type { Version } from '../../helpers/schemas.js';

const ALL: Version[] = ['3.0', '3.1', '3.2'];

/** A ring of N distinct schemas, each referencing the next: the worst case for recursive compilation. */
function ring(size: number): Record<string, unknown> {
  const components: Record<string, unknown> = {};
  for (let i = 0; i < size; i++) {
    components[`M${i}`] = {
      type: 'object',
      properties: {
        v: { type: 'integer' },
        next: { $ref: `#/components/schemas/M${(i + 1) % size}` },
      },
    };
  }
  return components;
}

describe.each(ALL)('OpenAPI %s: large reference graphs', (version) => {
  it('compiles a ring of 600 schemas without exhausting the call stack', async () => {
    const c = await compileSchema(
      { $ref: '#/components/schemas/M0' },
      { version, components: ring(600) },
    );
    accepts(c, { v: 1, next: { v: 2, next: { v: 3 } } });
    const violations = c.errors({ v: 1, next: { v: 2, next: { v: 'x' } } });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      instancePath: '/next/next/v',
      keyword: 'type',
      schemaPath: '/components/schemas/M2/properties/v/type',
    });
  });

  it('compiles a 1500 long linear chain', async () => {
    const components: Record<string, unknown> = {};
    for (let i = 0; i < 1500; i++) {
      components[`C${i}`] =
        i === 1499
          ? { type: 'string' }
          : { type: 'object', properties: { c: { $ref: `#/components/schemas/C${i + 1}` } } };
    }
    const c = await compileSchema({ $ref: '#/components/schemas/C0' }, { version, components });
    accepts(c, { c: { c: {} } });
    rejects(c, { c: 1 });
  });
});

describe('recursive schemas keep precise errors', () => {
  it('reports the location of an error deep inside a self-referencing schema', async () => {
    const c = await compileSchema(
      { $ref: '#/components/schemas/Tree' },
      {
        version: '3.1',
        components: {
          Tree: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' },
              children: { type: 'array', items: { $ref: '#/components/schemas/Tree' } },
            },
          },
        },
      },
    );
    accepts(c, { name: 'a', children: [{ name: 'b', children: [{ name: 'c' }] }] });
    const [violation] = c.errors({ name: 'a', children: [{ name: 'b', children: [{}] }] });
    expect(violation).toMatchObject({
      instancePath: '/children/0/children/0',
      keyword: 'required',
      schemaPath: '/components/schemas/Tree/required',
    });
  });

  it('reports errors raised directly in an inline entry schema with a contract location', async () => {
    const c = await compileSchema({ type: 'object', required: ['a'] }, { version: '3.1' });
    expect(c.errors({})[0]?.schemaPath).toBe('/components/schemas/Subject/required');
  });
});
