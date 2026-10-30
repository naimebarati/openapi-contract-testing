import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveOptions } from '../../../src/contract/contract-options.js';
import { loadDocument } from '../../../src/loader/load-document.js';
import { SchemaCompiler } from '../../../src/validation/schema-compiler.js';
import { accepts, compileSchema, rejects } from '../../helpers/schemas.js';
import type { Version } from '../../helpers/schemas.js';

const ALL: Version[] = ['3.0', '3.1', '3.2'];

describe.each(ALL)('OpenAPI %s: readOnly / writeOnly in responses', (version) => {
  const schema = {
    type: 'object',
    required: ['id', 'password'],
    properties: {
      id: { type: 'integer', readOnly: true },
      password: { type: 'string', writeOnly: true },
      name: { type: 'string' },
    },
  };

  it('writeOnly properties are not required; readOnly ones stay required', async () => {
    const c = await compileSchema(schema, { version });
    accepts(c, { id: 1, name: 'n' });
    accepts(c, { id: 1 });
    rejects(c, { name: 'n' });
  });

  it('a writeOnly property present in a response is an error by default', async () => {
    const c = await compileSchema(schema, { version });
    const [violation] = c.errors({ id: 1, password: 'leak' });
    expect(violation).toMatchObject({
      keyword: 'writeOnly',
      instancePath: '/password',
      severity: 'error',
      message: 'property is writeOnly and must not appear in a response',
    });
    expect(JSON.stringify(violation)).not.toContain('leak');
  });

  it("policy 'warning' downgrades the severity and 'ignore' allows the property", async () => {
    const warn = await compileSchema(schema, {
      version,
      options: { validation: { writeOnlyInResponse: 'warning' } },
    });
    expect(warn.errors({ id: 1, password: 'x' })[0]?.severity).toBe('warning');
    const ignore = await compileSchema(schema, {
      version,
      options: { validation: { writeOnlyInResponse: 'ignore' } },
    });
    accepts(ignore, { id: 1, password: 'x' });
    accepts(ignore, { id: 1 });
  });

  it('works through $ref properties and required declared in a sibling allOf member', async () => {
    const c = await compileSchema(
      { $ref: '#/components/schemas/User' },
      {
        version,
        components: {
          Pw: { type: 'string', writeOnly: true },
          Base: { type: 'object', required: ['pw', 'id'] },
          User: {
            allOf: [
              { $ref: '#/components/schemas/Base' },
              {
                type: 'object',
                properties: { id: { type: 'integer' }, pw: { $ref: '#/components/schemas/Pw' } },
              },
            ],
          },
        },
      },
    );
    accepts(c, { id: 1 });
    rejects(c, {});
    rejects(c, { id: 1, pw: 'x' });
  });

  it('does not remove other required properties or touch unrelated schemas', async () => {
    const c = await compileSchema(
      {
        type: 'object',
        required: ['a', 'b'],
        properties: { a: { type: 'string' }, b: { type: 'string', writeOnly: true } },
      },
      { version },
    );
    rejects(c, {});
    accepts(c, { a: 'x' });
  });
});

describe.each(ALL)('OpenAPI %s: discriminator', (version) => {
  const components = {
    Cat: { type: 'object', properties: { kind: { type: 'string' }, meow: { type: 'string' } } },
    Dog: { type: 'object', properties: { kind: { type: 'string' }, bark: { type: 'string' } } },
  };
  const variants = [{ $ref: '#/components/schemas/Cat' }, { $ref: '#/components/schemas/Dog' }];

  it('selects the variant by the discriminator value (implicit mapping by schema name)', async () => {
    const c = await compileSchema(
      { oneOf: variants, discriminator: { propertyName: 'kind' } },
      { version, components },
    );
    accepts(c, { kind: 'Cat', meow: 'x' });
    accepts(c, { kind: 'Dog', bark: 'x' });
    rejects(c, { kind: 'Cat', meow: 1 });
    rejects(c, { kind: 'Fish' });
    rejects(c, { meow: 'x' });
    const [violation] = c.errors({ kind: 'Cat', meow: 1 });
    expect(violation).toMatchObject({
      instancePath: '/meow',
      keyword: 'type',
      schemaPath: '/components/schemas/Cat/properties/meow/type',
    });
  });

  it('plain oneOf would reject the same valid payload because both variants match', async () => {
    const plain = await compileSchema({ oneOf: variants }, { version, components });
    rejects(plain, { kind: 'Cat', meow: 'x' });
  });

  it('uses explicit mapping', async () => {
    const c = await compileSchema(
      {
        oneOf: variants,
        discriminator: {
          propertyName: 'kind',
          mapping: { feline: '#/components/schemas/Cat', canine: 'Dog' },
        },
      },
      { version, components },
    );
    accepts(c, { kind: 'feline', meow: 'x' });
    accepts(c, { kind: 'canine', bark: 'x' });
    rejects(c, { kind: 'feline', meow: 1 });
  });

  it('works with anyOf', async () => {
    const c = await compileSchema(
      { anyOf: variants, discriminator: { propertyName: 'kind' } },
      { version, components },
    );
    accepts(c, { kind: 'Dog', bark: 'x' });
    rejects(c, { kind: 'Dog', bark: 1 });
  });

  it('falls back to plain oneOf with a warning when variants cannot be mapped', async () => {
    const c = await compileSchema(
      {
        oneOf: [
          { type: 'object', required: ['kind'], properties: { kind: { enum: ['a'] } } },
          { type: 'object', required: ['kind'], properties: { kind: { enum: ['b'] } } },
        ],
        discriminator: { propertyName: 'kind' },
      },
      { version },
    );
    accepts(c, { kind: 'a' });
    rejects(c, { kind: 'c' });
    const warnings = c.diagnostics.finalize('error');
    expect(warnings.some((w) => w.message.includes('falling back to plain oneOf'))).toBe(true);
  });

  it('treats a discriminator without oneOf/anyOf as an annotation and says so', async () => {
    const c = await compileSchema(
      { type: 'object', discriminator: { propertyName: 'kind' } },
      { version },
    );
    accepts(c, {});
    expect(c.diagnostics.finalize('error')[0]?.message).toMatch(/annotation/);
  });
});

describe('OpenAPI 3.2 discriminator.defaultMapping', () => {
  const components = {
    Cat: {
      type: 'object',
      required: ['meow'],
      properties: { kind: { type: 'string' }, meow: { type: 'string' } },
    },
    Other: { type: 'object', required: ['note'], properties: { note: { type: 'string' } } },
  };
  const schema = {
    oneOf: [{ $ref: '#/components/schemas/Cat' }, { $ref: '#/components/schemas/Other' }],
    discriminator: { propertyName: 'kind', defaultMapping: 'Other' },
  };

  it('validates unmapped values against the default schema', async () => {
    const c = await compileSchema(schema, { version: '3.2', components });
    accepts(c, { kind: 'Cat', meow: 'x' });
    accepts(c, { kind: 'whatever', note: 'x' });
    rejects(c, { kind: 'whatever' });
    rejects(c, { kind: 'Cat' });
  });
});

describe('schemas in external files', () => {
  it('compiles schemas that live in other files and reference each other', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'oct-schema-'));
    try {
      await writeFile(
        path.join(dir, 'user.yaml'),
        'type: object\nrequired: [id]\nproperties:\n  id: {type: string}\n  friend: {$ref: "./user.yaml"}\n  address: {$ref: "./address.yaml#/definitions/Address"}\n',
      );
      await writeFile(
        path.join(dir, 'address.yaml'),
        'definitions:\n  Address:\n    type: object\n    properties:\n      zip: {type: string, pattern: "^[0-9]{5}$"}\n',
      );
      await writeFile(
        path.join(dir, 'openapi.yaml'),
        'openapi: 3.1.0\ninfo: {title: t, version: "1"}\npaths: {}\ncomponents:\n  schemas:\n    User: {$ref: "./user.yaml"}\n',
      );
      const resolved = resolveOptions({ source: path.join(dir, 'openapi.yaml') });
      const doc = await loadDocument(resolved);
      const compiler = new SchemaCompiler(
        doc.version,
        doc.resolver,
        doc.rootKey,
        doc.diagnostics,
        resolved.validation,
      );
      const handle = await compiler.add({
        node: { $ref: './user.yaml' },
        loc: { docKey: doc.rootKey, pointer: '/x' },
      });
      compiler.build();
      const schema = compiler.get(handle);
      expect(schema.validate({ id: 'a', friend: { id: 'b' }, address: { zip: '12345' } })).toEqual(
        [],
      );
      const [violation] = schema.validate({ id: 'a', address: { zip: 'abc' } });
      expect(violation).toMatchObject({ instancePath: '/address/zip', keyword: 'pattern' });
      expect(violation?.schemaPath).toMatch(
        /^address\.yaml#\/definitions\/Address\/properties\/zip\/pattern$/,
      );
      expect(
        schema
          .validate({ friend: {} })
          .map((v) => `${v.keyword}:${v.instancePath}`)
          .sort(),
      ).toEqual(['required:', 'required:/friend']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe.each(ALL)(
  'OpenAPI %s: discriminator with non-object variants (GitHub contents API)',
  (version) => {
    const components = {
      Directory: { type: 'array', items: { $ref: '#/components/schemas/Entry' } },
      Entry: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
      File: {
        type: 'object',
        required: ['type'],
        properties: { type: { type: 'string', enum: ['file'] }, size: { type: 'integer' } },
      },
      Symlink: {
        type: 'object',
        required: ['type'],
        properties: { type: { type: 'string', enum: ['symlink'] }, target: { type: 'string' } },
      },
    };
    const schema = {
      oneOf: [
        { $ref: '#/components/schemas/Directory' },
        { $ref: '#/components/schemas/File' },
        { $ref: '#/components/schemas/Symlink' },
      ],
      discriminator: {
        propertyName: 'type',
        mapping: {
          array: '#/components/schemas/Directory',
          file: '#/components/schemas/File',
          symlink: '#/components/schemas/Symlink',
        },
      },
    };

    it('validates arrays with plain oneOf semantics and objects by their discriminator value', async () => {
      const c = await compileSchema(schema, { version, components });
      accepts(c, []);
      accepts(c, [{ name: 'a' }]);
      accepts(c, { type: 'file', size: 1 });
      accepts(c, { type: 'symlink', target: 'x' });
      rejects(c, [{}]);
      rejects(c, { type: 'file', size: 'big' });
      rejects(c, { type: 'dir' });
      rejects(c, { size: 1 });
      rejects(c, 'text');
      rejects(c, null);
    });

    it('still reports the variant-specific error with its contract location', async () => {
      const c = await compileSchema(schema, { version, components });
      const [violation] = c.errors({ type: 'file', size: 'big' });
      expect(violation).toMatchObject({
        instancePath: '/size',
        schemaPath: '/components/schemas/File/properties/size/type',
      });
    });
  },
);

describe.each(ALL)(
  'OpenAPI %s: discriminator values that are not schema names (OpenAI style)',
  (version) => {
    const components = {
      Message: {
        type: 'object',
        required: ['type', 'text'],
        properties: { type: { type: 'string', enum: ['message'] }, text: { type: 'string' } },
      },
      ToolCall: {
        type: 'object',
        required: ['type', 'name'],
        properties: { type: { type: 'string', enum: ['tool_call'] }, name: { type: 'string' } },
      },
    };
    const schema = {
      oneOf: [{ $ref: '#/components/schemas/Message' }, { $ref: '#/components/schemas/ToolCall' }],
      discriminator: { propertyName: 'type' },
    };

    it('accepts real values that differ from the schema names and still rejects wrong payloads', async () => {
      const c = await compileSchema(schema, { version, components });
      accepts(c, { type: 'message', text: 'hi' });
      accepts(c, { type: 'tool_call', name: 'f' });
      rejects(c, { type: 'message', text: 5 });
      rejects(c, { type: 'unknown' });
      rejects(c, { text: 'no type' });
    });

    it('still dispatches when the value is a schema name', async () => {
      const lenient = {
        Cat: { type: 'object', properties: { kind: { type: 'string' }, meow: { type: 'string' } } },
        Dog: { type: 'object', properties: { kind: { type: 'string' }, bark: { type: 'string' } } },
      };
      const c = await compileSchema(
        {
          oneOf: [{ $ref: '#/components/schemas/Cat' }, { $ref: '#/components/schemas/Dog' }],
          discriminator: { propertyName: 'kind' },
        },
        { version, components: lenient },
      );
      accepts(c, { kind: 'Cat', meow: 'x' }); // would match both variants structurally; dispatch picks Cat
      rejects(c, { kind: 'Cat', meow: 1 });
    });
  },
);
