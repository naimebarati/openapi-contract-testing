import { describe, expect, it } from 'vitest';
import { OpenApiSpecError } from '../../../src/index.js';
import { accepts, compileSchema, rejects } from '../../helpers/schemas.js';
import type { Version } from '../../helpers/schemas.js';

const ALL: Version[] = ['3.0', '3.1', '3.2'];
const MODERN: Version[] = ['3.1', '3.2'];

describe.each(ALL)('OpenAPI %s: common keywords', (version) => {
  it('enforces required, additionalProperties, enum and nested types', async () => {
    const c = await compileSchema(
      {
        type: 'object',
        required: ['id'],
        additionalProperties: false,
        properties: {
          id: { type: 'integer' },
          kind: { type: 'string', enum: ['a', 'b'] },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
      { version },
    );
    accepts(c, { id: 1, kind: 'a', tags: ['x'] });
    rejects(c, {});
    rejects(c, { id: 1, extra: true });
    rejects(c, { id: 1, kind: 'c' });
    rejects(c, { id: 1, tags: [1] });
    rejects(c, { id: 1.5 });
  });

  it('supports oneOf, anyOf, allOf and not', async () => {
    const one = await compileSchema(
      { oneOf: [{ type: 'string' }, { type: 'integer' }] },
      { version },
    );
    accepts(one, 'a');
    accepts(one, 1);
    rejects(one, true);
    const any = await compileSchema(
      {
        anyOf: [
          { type: 'string', maxLength: 2 },
          { type: 'string', minLength: 5 },
        ],
      },
      { version },
    );
    accepts(any, 'ab');
    accepts(any, 'abcdef');
    rejects(any, 'abc');
    const all = await compileSchema(
      {
        allOf: [
          { type: 'object', required: ['a'] },
          { type: 'object', required: ['b'] },
        ],
      },
      { version },
    );
    accepts(all, { a: 1, b: 2 });
    rejects(all, { a: 1 });
    const not = await compileSchema({ not: { type: 'string' } }, { version });
    accepts(not, 1);
    rejects(not, 'x');
  });

  it('applies string, number and array constraints', async () => {
    const c = await compileSchema(
      {
        type: 'object',
        properties: {
          s: { type: 'string', minLength: 2, maxLength: 3, pattern: '^[a-z]+$' },
          n: { type: 'number', multipleOf: 0.5, minimum: 0, maximum: 10 },
          a: { type: 'array', minItems: 1, maxItems: 2, uniqueItems: true },
        },
      },
      { version },
    );
    accepts(c, { s: 'ab', n: 2.5, a: [1] });
    rejects(c, { s: 'a' });
    rejects(c, { s: 'abcd' });
    rejects(c, { s: 'AB' });
    rejects(c, { n: 2.2 });
    rejects(c, { n: 11 });
    rejects(c, { a: [] });
    rejects(c, { a: [1, 2, 3] });
    rejects(c, { a: [1, 1] });
  });

  it('validates standard formats and rejects wrong ones', async () => {
    const c = await compileSchema(
      {
        type: 'object',
        properties: {
          e: { type: 'string', format: 'email' },
          dt: { type: 'string', format: 'date-time' },
          d: { type: 'string', format: 'date' },
          u: { type: 'string', format: 'uuid' },
          i: { type: 'integer', format: 'int32' },
        },
      },
      { version },
    );
    accepts(c, {
      e: 'a@b.co',
      dt: '2020-01-01T00:00:00Z',
      d: '2020-02-29',
      u: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      i: 1,
    });
    rejects(c, { e: 'nope' });
    rejects(c, { dt: 'yesterday' });
    rejects(c, { d: '2021-02-29' });
    rejects(c, { u: 'zzz' });
    rejects(c, { i: 2 ** 40 });
  });

  it('handles circular references', async () => {
    const c = await compileSchema(
      { $ref: '#/components/schemas/Node' },
      {
        version,
        components: {
          Node: {
            type: 'object',
            properties: { v: { type: 'integer' }, next: { $ref: '#/components/schemas/Node' } },
          },
        },
      },
    );
    accepts(c, { v: 1, next: { v: 2, next: { v: 3 } } });
    rejects(c, { v: 1, next: { v: 2, next: { v: 'x' } } });
  });

  it('keeps properties that are named like keywords', async () => {
    const c = await compileSchema(
      {
        type: 'object',
        required: ['nullable'],
        properties: {
          nullable: { type: 'boolean' },
          example: { type: 'string' },
          'x-foo': { type: 'integer' },
          required: { type: 'string' },
        },
      },
      { version },
    );
    accepts(c, { nullable: true, example: 'e', 'x-foo': 1, required: 'r' });
    rejects(c, {});
    rejects(c, { nullable: null });
    rejects(c, { nullable: true, 'x-foo': 'a' });
  });

  it('accepts OpenAPI annotation keywords and x- extensions', async () => {
    const c = await compileSchema(
      {
        type: 'object',
        'x-internal': true,
        example: {},
        xml: { name: 'a' },
        externalDocs: { url: 'http://x' },
        deprecated: true,
        description: 'd',
        title: 't',
      },
      { version },
    );
    accepts(c, {});
    expect(c.diagnostics.count).toBe(0);
  });

  it('does not mutate documents (they are frozen) or the validated value', async () => {
    const value = { id: 1, nested: { a: [1, 2] } };
    const snapshot = structuredClone(value);
    const c = await compileSchema(
      { type: 'object', properties: { id: { type: 'string' } }, default: {} },
      { version },
    );
    c.errors(value);
    expect(value).toEqual(snapshot);
  });

  it('never coerces types or applies defaults', async () => {
    const c = await compileSchema(
      { type: 'object', properties: { n: { type: 'integer', default: 5 } } },
      { version },
    );
    rejects(c, { n: '5' });
    const value = {};
    c.errors(value);
    expect(value).toEqual({});
  });
});

describe('OpenAPI 3.0 dialect', () => {
  const v = { version: '3.0' as const };

  it('nullable', async () => {
    const c = await compileSchema({ type: 'string', nullable: true }, v);
    accepts(c, null);
    accepts(c, 'a');
    rejects(c, 1);
    rejects(await compileSchema({ type: 'string', nullable: false }, v), null);
  });

  it('nullable + enum: null is only valid if listed (3.0.3)', async () => {
    const without = await compileSchema({ type: 'string', nullable: true, enum: ['a', 'b'] }, v);
    accepts(without, 'a');
    rejects(without, null);
    const withNull = await compileSchema({ type: 'string', nullable: true, enum: ['a', null] }, v);
    accepts(withNull, null);
  });

  it('nullable inside properties, items and oneOf', async () => {
    const c = await compileSchema(
      {
        type: 'object',
        properties: {
          a: { type: 'integer', nullable: true },
          l: { type: 'array', items: { type: 'string', nullable: true } },
          o: { oneOf: [{ type: 'string', nullable: true }, { type: 'integer' }] },
        },
      },
      v,
    );
    accepts(c, { a: null, l: ['x', null], o: null });
    rejects(c, { l: [1] });
  });

  it('nullable without type has no effect', async () => {
    const c = await compileSchema({ nullable: true, minimum: 1 }, v);
    accepts(c, 2);
    rejects(c, 0);
  });

  it('boolean exclusiveMinimum / exclusiveMaximum', async () => {
    const c = await compileSchema(
      { type: 'number', minimum: 5, exclusiveMinimum: true, maximum: 10, exclusiveMaximum: false },
      v,
    );
    accepts(c, 5.1);
    accepts(c, 10);
    rejects(c, 5);
    rejects(c, 11);
  });

  it('reports siblings of $ref as ignored (warning), as the specification says', async () => {
    const c = await compileSchema(
      { $ref: '#/components/schemas/A', maxLength: 1 },
      { ...v, components: { A: { type: 'string' } } },
    );
    accepts(c, 'long');
    const warnings = c.diagnostics.finalize('error');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: 'spec.unsupported_feature', severity: 'warning' });
    expect(warnings[0]?.message).toContain('maxLength');
  });
});

describe.each(MODERN)('OpenAPI %s dialect (JSON Schema 2020-12)', (version) => {
  const v = { version };

  it('type arrays with null', async () => {
    const c = await compileSchema({ type: ['string', 'null'], maxLength: 3 }, v);
    accepts(c, null);
    accepts(c, 'abc');
    rejects(c, 'abcd');
    rejects(c, 1);
  });

  it('numeric exclusiveMinimum / exclusiveMaximum', async () => {
    const c = await compileSchema({ type: 'number', exclusiveMinimum: 5, exclusiveMaximum: 10 }, v);
    accepts(c, 5.1);
    rejects(c, 5);
    rejects(c, 10);
  });

  it('3.0-style boolean exclusiveMinimum is rejected at load, not misread', async () => {
    await expect(
      compileSchema({ type: 'number', minimum: 5, exclusiveMinimum: true }, v),
    ).rejects.toMatchObject({
      issues: [{ code: 'schema.compile_failed' }],
    });
  });

  it('$ref siblings apply together with the referenced schema', async () => {
    const c = await compileSchema(
      { $ref: '#/components/schemas/A', maxLength: 3 },
      { ...v, components: { A: { type: 'string', minLength: 2 } } },
    );
    accepts(c, 'ab');
    rejects(c, 'a');
    rejects(c, 'abcd');
  });

  it('prefixItems, const, if/then/else, dependentRequired, unevaluatedProperties', async () => {
    const tuple = await compileSchema(
      { type: 'array', prefixItems: [{ type: 'string' }, { type: 'integer' }], items: false },
      v,
    );
    accepts(tuple, ['a', 1]);
    rejects(tuple, ['a', 1, 2]);
    const konst = await compileSchema({ const: 'x' }, v);
    accepts(konst, 'x');
    rejects(konst, 'y');
    const cond = await compileSchema(
      {
        if: { properties: { a: { const: 1 } }, required: ['a'] },
        then: { required: ['b'] },
        else: { required: ['c'] },
      },
      v,
    );
    accepts(cond, { a: 1, b: 1 });
    accepts(cond, { c: 1 });
    rejects(cond, { a: 1 });
    const dep = await compileSchema({ dependentRequired: { a: ['b'] } }, v);
    accepts(dep, { a: 1, b: 1 });
    rejects(dep, { a: 1 });
    const uneval = await compileSchema(
      { type: 'object', properties: { a: {} }, unevaluatedProperties: false },
      v,
    );
    accepts(uneval, { a: 1 });
    rejects(uneval, { b: 1 });
  });

  it('boolean schemas', async () => {
    const c = await compileSchema({ type: 'object', properties: { never: false, any: true } }, v);
    accepts(c, { any: 1 });
    rejects(c, { never: 1 });
  });

  it('reports nullable as unsupported instead of ignoring it', async () => {
    const c = await compileSchema({ type: 'string', nullable: true }, v);
    rejects(c, null);
    expect(() => c.diagnostics.finalize('error')).toThrow(/nullable/);
    expect(c.diagnostics.finalize('warning')[0]).toMatchObject({
      code: 'spec.unsupported_feature',
      severity: 'warning',
    });
  });

  it('reports unsupported reference keywords ($anchor, $dynamicRef, $id)', async () => {
    for (const keyword of ['$anchor', '$dynamicRef', '$id']) {
      const c = await compileSchema({ type: 'string', [keyword]: 'x' }, v);
      expect(() => c.diagnostics.finalize('error'), keyword).toThrow(new RegExp(`\\${keyword}`));
    }
  });

  it('reports unknown schema keywords instead of dropping them', async () => {
    const c = await compileSchema({ type: 'string', frobnicate: 1 }, v);
    expect(() => c.diagnostics.finalize('error')).toThrow(/frobnicate/);
  });
});

describe('formats', () => {
  it.each(ALL)(
    'OpenAPI %s: unknown formats are warned about and treated as annotations',
    async (version) => {
      const c = await compileSchema({ type: 'string', format: 'currency-code' }, { version });
      accepts(c, 'anything');
      const warnings = c.diagnostics.finalize('error');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.message).toContain('currency-code');
    },
  );

  it.each(ALL)('OpenAPI %s: custom formats as function and RegExp', async (version) => {
    const customFormats = {
      'even-length': (s: string) => s.length % 2 === 0,
      'two-digits': /^\d\d$/,
    };
    const c = await compileSchema(
      {
        type: 'object',
        properties: {
          a: { type: 'string', format: 'even-length' },
          b: { type: 'string', format: 'two-digits' },
        },
      },
      { version, options: { validation: { customFormats } } },
    );
    accepts(c, { a: 'ab', b: '12' });
    rejects(c, { a: 'abc' });
    rejects(c, { b: '1' });
    expect(c.diagnostics.count).toBe(0);
    expect(c.diagnostics.finalize('error')).toEqual([]);
  });

  it.each(ALL)('OpenAPI %s: validateFormats=false skips format assertions', async (version) => {
    const c = await compileSchema(
      { type: 'string', format: 'email' },
      { version, options: { validation: { validateFormats: false } } },
    );
    accepts(c, 'not-an-email');
  });
});

describe('invalid schemas fail at load with a location', () => {
  it.each(MODERN)('OpenAPI %s: type typo is schema.compile_failed', async (version) => {
    try {
      await compileSchema({ type: 'strng' }, { version });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(OpenApiSpecError);
      const issue = (error as OpenApiSpecError).issues[0];
      expect(issue?.code).toBe('schema.compile_failed');
      expect(issue?.message).toContain('#/components/schemas/Subject');
    }
  });

  it('OpenAPI 3.0: the structural check already rejects it', async () => {
    await expect(compileSchema({ type: 'strng' }, { version: '3.0' })).rejects.toBeInstanceOf(
      OpenApiSpecError,
    );
  });

  it('a pattern that is not a valid regular expression fails at load', async () => {
    await expect(
      compileSchema({ type: 'string', pattern: '(' }, { version: '3.1' }),
    ).rejects.toMatchObject({
      issues: [{ code: 'schema.compile_failed' }],
    });
  });

  it.each([{ const: 'x' }, { prefixItems: [{}] }, { if: {} }])(
    'OpenAPI 3.0 rejects JSON Schema 2020-12 keywords instead of ignoring them: %j',
    async (schema) => {
      await expect(compileSchema(schema, { version: '3.0' })).rejects.toMatchObject({
        issues: [{ code: 'spec.invalid' }],
      });
    },
  );

  it('a broken $ref is reference.not_found', async () => {
    await expect(compileSchema({ $ref: '#/components/schemas/Missing' })).rejects.toMatchObject({
      issues: [{ code: 'reference.not_found' }],
    });
  });
});

describe('violations', () => {
  it('report instance path, contract location, keyword and expectation', async () => {
    const c = await compileSchema(
      {
        type: 'object',
        required: ['user'],
        properties: { user: { $ref: '#/components/schemas/User' } },
      },
      {
        components: {
          User: {
            type: 'object',
            required: ['email'],
            properties: { email: { type: 'string', format: 'email' }, age: { type: 'integer' } },
          },
        },
      },
    );
    const violations = c.errors({ user: { email: 5, age: 'x' } });
    const byPath = Object.fromEntries(violations.map((v) => [v.instancePath, v]));
    expect(byPath['/user/email']).toMatchObject({
      keyword: 'type',
      schemaPath: '/components/schemas/User/properties/email/type',
      message: 'must be string (received integer)',
      expected: { type: 'string' },
      actualType: 'integer',
      severity: 'error',
    });
    expect(byPath['/user/age']?.message).toBe('must be integer (received string)');
    expect(c.errors({ user: {} })[0]).toMatchObject({
      keyword: 'required',
      instancePath: '/user',
      expected: { requiredProperty: 'email' },
    });
    expect(c.errors({ user: { email: 'nope' } })[0]).toMatchObject({
      keyword: 'format',
      message: 'must match format "email"',
    });
  });

  it('never contain actual values unless requested', async () => {
    const schema = {
      type: 'object',
      properties: { password: { type: 'string', maxLength: 3 } },
      additionalProperties: false,
    };
    const hidden = await compileSchema(schema);
    const violations = hidden.errors({ password: 'super-secret-value', token: 'abc' });
    expect(JSON.stringify(violations)).not.toContain('super-secret-value');
    expect(violations.every((v) => v.actual === undefined)).toBe(true);

    const shown = await compileSchema(schema, {
      options: { validation: { includeActualValues: true } },
    });
    const withActual = shown.errors({ password: 'super-secret-value' });
    expect(withActual.find((v) => v.keyword === 'maxLength')?.actual).toBe('super-secret-value');
  });

  it('truncates long actual values when requested', async () => {
    const shown = await compileSchema(
      { type: 'string', maxLength: 3 },
      { options: { validation: { includeActualValues: true } } },
    );
    const actual = shown.errors('x'.repeat(500))[0]?.actual as string;
    expect(actual.length).toBeLessThan(200);
  });

  it('are deterministic', async () => {
    const c = await compileSchema({ type: 'object', required: ['a', 'b', 'c'] });
    expect(c.errors({})).toEqual(c.errors({}));
  });
});

describe('schema sharing', () => {
  it('compiles the schema at one location once, however many responses reference it', async () => {
    const { resolveOptions } = await import('../../../src/contract/contract-options.js');
    const { loadDocument } = await import('../../../src/loader/load-document.js');
    const { SchemaCompiler } = await import('../../../src/validation/schema-compiler.js');
    const { oas } = await import('../../helpers/contracts.js');
    const resolved = resolveOptions({
      document: oas({}, { components: { schemas: { A: { type: 'string' } } } }),
    });
    const doc = await loadDocument(resolved);
    const compiler = new SchemaCompiler(
      doc.version,
      doc.resolver,
      doc.rootKey,
      doc.diagnostics,
      resolved.validation,
    );
    const source = {
      node: { type: 'string' },
      loc: { docKey: doc.rootKey, pointer: '/components/schemas/A' },
    };
    const first = await compiler.add(source);
    expect(await compiler.add(source)).toBe(first);
    compiler.build();
    expect(compiler.get(first).validate('x')).toEqual([]);
  });
});

describe.each(ALL)('OpenAPI %s: documentation keywords never reach the validator', (version) => {
  it('examples, defaults and xml containing id-like or $ref-like data do not break compilation', async () => {
    const c = await compileSchema(
      {
        type: 'object',
        properties: { name: { type: 'string', example: 'x' } },
        example: { id: 'not:a-uri', $id: 'https://[bad', $ref: '#/nowhere', name: 'x' },
        default: { id: 'a:b' },
        xml: { name: 'thing' },
        externalDocs: { url: 'http://x' },
      },
      { version },
    );
    accepts(c, { name: 'a' });
    rejects(c, { name: 1 });
    expect(c.diagnostics.count).toBe(0);
  });
});

describe.each(ALL)(
  'OpenAPI %s: patterns that are only valid without the Unicode flag',
  (version) => {
    it('compile (with a warning) instead of failing the whole contract', async () => {
      const c = await compileSchema(
        { type: 'string', pattern: '^[a-zA-Z0-9_\\-\\:]+$' },
        { version },
      );
      accepts(c, 'a-b:c_1');
      rejects(c, 'a b');
      const warnings = c.diagnostics.finalize('error');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.message).toContain('without the "u" flag');
    });

    it('still rejects a pattern that is invalid in both modes', async () => {
      // OpenAPI 3.0's document schema already checks that `pattern` is a regex; 3.1+ fails when compiling.
      const error = await compileSchema({ type: 'string', pattern: '(' }, { version }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(OpenApiSpecError);
      expect(['schema.compile_failed', 'spec.invalid']).toContain(
        (error as OpenApiSpecError).issues[0]?.code,
      );
    });

    it('keeps Unicode semantics for patterns that are valid with the flag', async () => {
      const c = await compileSchema({ type: 'string', pattern: '^\\p{L}+$' }, { version });
      accepts(c, 'héllo');
      rejects(c, 'h3llo');
      expect(c.diagnostics.count).toBe(0);
    });
  },
);
