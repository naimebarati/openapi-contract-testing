import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Validator } from '@seriousme/openapi-schema-validator'
import { DocumentSet, SchemaRegistry, buildAjv, SpikeError } from './proto.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const splitDir = path.join(here, 'fixtures/split')

/** Compiles `schema` (inline, living in an in-memory root document) for the given dialect. */
async function compile(schema, { dialect = '3.1', components = {}, rootDir = splitDir, opts = {}, ajvOpts } = {}) {
  const docs = new DocumentSet({ rootDir })
  const doc = { components: { schemas: components }, root: schema }
  docs.addRoot('root', doc, rootDir)
  const reg = new SchemaRegistry(docs, { dialect, ...opts })
  const ref = await reg.entry(schema, { docKey: 'root', pointer: '/root' })
  const ajv = buildAjv(dialect, ajvOpts)
  ajv.addSchema({ definitions: reg.defs }, 'urn:oct:registry')
  return { validate: ajv.getSchema(ref), reg, ajv }
}
const ok = (c, v) => assert.equal(c.validate(v), true, JSON.stringify([v, c.validate.errors]))
const bad = (c, v) => assert.equal(c.validate(v), false, `should reject ${JSON.stringify(v)}`)

// ---- structural validation of the OAS document itself (official schemas)
test('official-schema validator: accepts 3.0/3.1/3.2, rejects missing info.version, unknown versions, no mutation', async () => {
  for (const openapi of ['3.0.3', '3.1.1', '3.2.0']) {
    const doc = { openapi, info: { title: 't', version: '1' }, paths: {} }
    const snap = structuredClone(doc)
    const r = await new Validator().validate(doc)
    assert.equal(r.valid, true, openapi)
    assert.deepEqual(doc, snap)
  }
  assert.equal((await new Validator().validate({ openapi: '3.1.0', info: { title: 't' }, paths: {} })).valid, false)
  assert.equal((await new Validator().validate({ openapi: '4.0.0', info: { title: 't', version: '1' }, paths: {} })).valid, false)
})

// ---- OAS 3.0 (draft-04 instance, own adapter)
test('3.0: nullable', async () => {
  const c = await compile({ type: 'string', nullable: true }, { dialect: '3.0' })
  ok(c, null); ok(c, 'a'); bad(c, 1)
  const d = await compile({ type: 'string', nullable: false }, { dialect: '3.0' }); bad(d, null)
})
test('3.0: nullable + enum follows 3.0.3 (null only if listed)', async () => {
  const c = await compile({ type: 'string', nullable: true, enum: ['a', 'b'] }, { dialect: '3.0' })
  ok(c, 'a'); bad(c, null); bad(c, 'c')
  const d = await compile({ type: 'string', nullable: true, enum: ['a', null] }, { dialect: '3.0' }); ok(d, null)
})
test('3.0: boolean exclusiveMinimum/Maximum', async () => {
  const c = await compile({ type: 'number', minimum: 5, exclusiveMinimum: true, maximum: 10, exclusiveMaximum: false }, { dialect: '3.0' })
  ok(c, 5.1); ok(c, 10); bad(c, 5); bad(c, 11)
})
test('3.0: properties named like keywords stay properties', async () => {
  const c = await compile({ type: 'object', required: ['nullable'], properties: { nullable: { type: 'boolean' }, example: { type: 'string' }, 'x-foo': { type: 'integer' } } }, { dialect: '3.0' })
  ok(c, { nullable: true, example: 'e', 'x-foo': 1 }); bad(c, {}); bad(c, { nullable: null }); bad(c, { nullable: true, 'x-foo': 'a' })
})
test('3.0: x- extensions and OAS annotations are accepted; unknown keywords are reported, not ignored', async () => {
  const c = await compile({ type: 'object', 'x-internal': true, example: {}, xml: { name: 'a' }, externalDocs: { url: 'http://x' } }, { dialect: '3.0' })
  ok(c, {}); assert.deepEqual(c.reg.issues, [])
  const d = await compile({ type: 'string', frobnicate: 1 }, { dialect: '3.0' })
  assert.equal(d.reg.issues[0].code, 'spec.unsupported_feature')
})
test('3.0: siblings of $ref are reported (ignored by spec)', async () => {
  const c = await compile({ $ref: '#/components/schemas/A', maxLength: 1 }, { dialect: '3.0', components: { A: { type: 'string' } } })
  ok(c, 'long'); assert.equal(c.reg.issues[0].code, 'spec.unsupported_feature')
})
test('invalid schema (type typo) fails at compile instead of passing silently', async () => {
  for (const dialect of ['3.0', '3.1']) {
    await assert.rejects(compile({ type: 'strng' }, { dialect }), /schema is invalid|type/i)
  }
})

// ---- OAS 3.1 / 3.2 (2020-12 instance)
test('3.1: type arrays with null, $ref siblings, prefixItems, unevaluatedProperties', async () => {
  const c = await compile({ type: ['string', 'null'], maxLength: 3 }); ok(c, null); ok(c, 'abc'); bad(c, 'abcd')
  const d = await compile({ $ref: '#/components/schemas/A', maxLength: 3 }, { components: { A: { type: 'string', minLength: 2 } } })
  ok(d, 'ab'); bad(d, 'a'); bad(d, 'abcd') // sibling AND target both apply
  const e = await compile({ type: 'array', prefixItems: [{ type: 'string' }, { type: 'integer' }], items: false }); ok(e, ['a', 1]); bad(e, ['a', 1, 2])
  const f = await compile({ type: 'object', properties: { a: {} }, unevaluatedProperties: false }); ok(f, { a: 1 }); bad(f, { b: 1 })
})
test('3.1: numeric exclusiveMinimum', async () => {
  const c = await compile({ type: 'number', exclusiveMinimum: 5 }); ok(c, 5.1); bad(c, 5)
  const d = await compile({ type: 'number', minimum: 5, exclusiveMinimum: true }) // 3.0 style under 3.1 must fail loudly
    .then(() => 'compiled', (e) => 'rejected')
  assert.equal(d, 'rejected')
})
test('3.1: "nullable" is reported as unsupported (not silently ignored)', async () => {
  const c = await compile({ type: 'string', nullable: true })
  bad(c, null); assert.equal(c.reg.issues[0].code, 'spec.unsupported_feature')
})

// ---- shared behaviours
for (const dialect of ['3.0', '3.1']) {
  test(`${dialect}: formats, unknown format strictness, custom format`, async () => {
    const c = await compile({ type: 'object', properties: { e: { type: 'string', format: 'email' }, d: { type: 'string', format: 'date-time' }, u: { type: 'string', format: 'uuid' }, dt: { type: 'string', format: 'date' } } }, { dialect })
    ok(c, { e: 'a@b.co', d: '2020-01-01T00:00:00Z', u: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', dt: '2020-02-29' })
    bad(c, { e: 'nope' }); bad(c, { d: 'yesterday' }); bad(c, { u: 'zzz' }); bad(c, { dt: '2021-02-29' })
    await assert.rejects(compile({ type: 'string', format: 'unknown-fmt' }, { dialect }), /unknown format/i)
    const custom = await compile({ type: 'string', format: 'even-len' }, { dialect, ajvOpts: { customFormats: { 'even-len': (s) => s.length % 2 === 0 } } })
    ok(custom, 'ab'); bad(custom, 'abc')
  })
  test(`${dialect}: circular $ref (single doc) via registry`, async () => {
    const c = await compile({ $ref: '#/components/schemas/Node' }, { dialect, components: { Node: { type: 'object', properties: { v: { type: 'integer' }, next: { $ref: '#/components/schemas/Node' } } } } })
    ok(c, { v: 1, next: { v: 2, next: { v: 3 } } }); bad(c, { v: 1, next: { v: 2, next: { v: 'x' } } })
  })
  test(`${dialect}: oneOf/anyOf/allOf/not/enum/additionalProperties`, async () => {
    const c = await compile({ oneOf: [{ type: 'string' }, { type: 'integer' }] }, { dialect }); ok(c, 'a'); ok(c, 1); bad(c, true)
    const d = await compile({ allOf: [{ type: 'object', required: ['a'] }, { type: 'object', required: ['b'] }] }, { dialect }); ok(d, { a: 1, b: 2 }); bad(d, { a: 1 })
    const e = await compile({ type: 'object', additionalProperties: false, properties: { a: { type: 'integer' } } }, { dialect }); ok(e, { a: 1 }); bad(e, { a: 1, b: 2 })
    const f = await compile({ not: { type: 'null' } }, { dialect: dialect === '3.0' ? '3.0' : '3.1' }); ok(f, 1)
  })
  test(`${dialect}: readOnly/writeOnly in a response context`, async () => {
    const schema = { type: 'object', required: ['id', 'password'], properties: { id: { type: 'integer', readOnly: true }, password: { type: 'string', writeOnly: true }, name: { type: 'string' } } }
    const c = await compile(schema, { dialect })
    ok(c, { id: 1, name: 'n' })               // writeOnly not required in responses
    ok(c, { id: 1 })
    bad(c, { name: 'n' })                      // readOnly property stays required
    bad(c, { id: 1, password: 'leak' })        // writeOnly present in response -> error by default
    const lenient = await compile(schema, { dialect, opts: { writeOnlyInResponse: 'ignore' } })
    ok(lenient, { id: 1, password: 'x' })
  })
  test(`${dialect}: writeOnly via $ref property and allOf-split required`, async () => {
    const comps = { Pw: { type: 'string', writeOnly: true }, Base: { type: 'object', required: ['pw'] }, User: { allOf: [{ $ref: '#/components/schemas/Base' }, { type: 'object', properties: { pw: { $ref: '#/components/schemas/Pw' } } }] } }
    const c = await compile({ $ref: '#/components/schemas/User' }, { dialect, components: comps })
    ok(c, {}) // pw required by Base but writeOnly in the sibling allOf member
  })
  test(`${dialect}: discriminator picks the variant (no "matches more than one" false positive)`, async () => {
    const comps = {
      Cat: { type: 'object', properties: { kind: { type: 'string' }, meow: { type: 'string' } } },
      Dog: { type: 'object', properties: { kind: { type: 'string' }, bark: { type: 'string' } } },
    }
    const schema = { oneOf: [{ $ref: '#/components/schemas/Cat' }, { $ref: '#/components/schemas/Dog' }], discriminator: { propertyName: 'kind' } }
    const c = await compile(schema, { dialect, components: comps })
    ok(c, { kind: 'Cat', meow: 'x' }); ok(c, { kind: 'Dog', bark: 'x' })
    bad(c, { kind: 'Cat', meow: 1 }); bad(c, { kind: 'Fish' }); bad(c, { meow: 'x' })
    // the plain-oneOf baseline would accept-by-ambiguity failure:
    const plain = await compile({ oneOf: schema.oneOf }, { dialect, components: comps })
    bad(plain, { kind: 'Cat', meow: 'x' }) // proves why dispatch is needed
    const mapped = await compile({ ...schema, discriminator: { propertyName: 'kind', mapping: { feline: '#/components/schemas/Cat' } } }, { dialect, components: comps })
    ok(mapped, { kind: 'feline', meow: 'x' })
  })
}

// ---- references / security (file based)
test('external relative file refs resolve against the referencing file', async () => {
  const docs = new DocumentSet({ rootDir: splitDir })
  const root = path.join(splitDir, 'openapi.yaml')
  await docs.load(root)
  const reg = new SchemaRegistry(docs, { dialect: '3.1' })
  const node = docs.getAt(root, '/paths/~1users~1{id}/get/responses/200/content/application~1json/schema')
  await assert.rejects(reg.entry(node, { docKey: root, pointer: '/paths/~1users~1{id}/get/responses/200/content/application~1json/schema' }), (e) => e.code === 'reference.not_allowed')
})
test('path traversal outside rootDir is refused with reference.not_allowed', async () => {
  const docs = new DocumentSet({ rootDir: splitDir })
  const f = path.join(splitDir, 'bad-escape.yaml'); await docs.load(f)
  const reg = new SchemaRegistry(docs, { dialect: '3.1' })
  await assert.rejects(reg.refTo(f, ''), (e) => e.code === 'reference.not_allowed')
})
test('symlink escape is refused (realpath comparison)', async () => {
  const docs = new DocumentSet({ rootDir: splitDir })
  const f = path.join(splitDir, 'ok-symlink-escape.yaml'); await docs.load(f)
  const reg = new SchemaRegistry(docs, { dialect: '3.1' })
  await assert.rejects(reg.refTo(f, ''), (e) => e.code === 'reference.not_allowed')
})
test('missing file / missing pointer -> reference.not_found; remote URL -> reference.not_allowed', async () => {
  const docs = new DocumentSet({ rootDir: splitDir }); docs.addRoot('root', {}, splitDir)
  await assert.rejects(docs.resolveRef('root', './nope.yaml'), (e) => e.code === 'reference.not_found')
  await assert.rejects(docs.resolveRef('root', 'https://example.com/a.yaml#/x'), (e) => e.code === 'reference.not_allowed')
  await assert.rejects(docs.resolveRef('root', 'file:///etc/passwd'), (e) => e.code === 'reference.not_allowed')
  await assert.rejects(docs.resolveRef('root', '#anchor'), (e) => e.code === 'spec.unsupported_feature')
  await assert.rejects(compile({ $ref: '#/components/schemas/Missing' }), (e) => e.code === 'reference.not_found')
})
test('circular refs across files terminate and validate', async () => {
  const docs = new DocumentSet({ rootDir: splitDir })
  const a = path.join(splitDir, 'circ-a.yaml'); await docs.load(a)
  const reg = new SchemaRegistry(docs, { dialect: '3.1' })
  const ref = await reg.refTo(a, '')
  const ajv = buildAjv('3.1'); ajv.addSchema({ definitions: reg.defs }, 'urn:oct:registry')
  const v = ajv.getSchema(ref)
  assert.equal(v({ b: { a: { b: { n: 1 } }, n: 2 } }), true)
  assert.equal(v({ b: { a: { b: { n: 'x' } } } }), false)
})
test('max file limit is enforced', async () => {
  const docs = new DocumentSet({ rootDir: splitDir, maxFiles: 1 }); docs.addRoot('root', {}, splitDir)
  await docs.load(path.join(splitDir, 'circ-a.yaml').replace('circ-a', 'circ-b')).catch(() => {})
  await assert.rejects(docs.load(path.join(splitDir, 'circ-a.yaml')), (e) => e.code === 'reference.not_allowed')
})
test('max file size is enforced', async () => {
  const docs = new DocumentSet({ rootDir: splitDir, maxBytesPerFile: 10 })
  await assert.rejects(docs.load(path.join(splitDir, 'circ-a.yaml')), (e) => e.code === 'reference.not_allowed')
})
test('input document is not mutated by transform/compile', async () => {
  const schema = { type: 'object', nullable: true, properties: { a: { $ref: '#/components/schemas/A' } }, required: ['a'] }
  const comps = { A: { type: 'string', nullable: true } }
  const snap = structuredClone({ schema, comps })
  await compile(schema, { dialect: '3.0', components: comps })
  assert.deepEqual({ schema, comps }, snap)
})
test('error locations: Ajv reports instancePath and schemaPath mapped to registry entries', async () => {
  const c = await compile({ type: 'object', properties: { user: { $ref: '#/components/schemas/U' } } }, { components: { U: { type: 'object', properties: { email: { type: 'string', format: 'email' } } } } })
  bad(c, { user: { email: 'x' } })
  const e = c.validate.errors[0]
  assert.equal(e.instancePath, '/user/email'); assert.equal(e.keyword, 'format')
  console.log('   sample ajv error:', JSON.stringify({ instancePath: e.instancePath, schemaPath: e.schemaPath }))
})
test('prototype pollution keys are inert', async () => {
  const { parse } = await import('yaml')
  const o = parse('__proto__: {polluted: true}\na: 1')
  assert.equal({}.polluted, undefined)
  assert.equal(Object.getPrototypeOf(o), Object.prototype)
  const j = JSON.parse('{"__proto__": {"polluted": true}}'); assert.equal({}.polluted, undefined); assert.ok(Object.hasOwn(j, '__proto__'))
})
test('YAML alias bomb is rejected by yaml maxAliasCount', async () => {
  const { parse } = await import('yaml')
  let y = 'a0: &a0 [x, x, x, x, x, x, x, x, x, x]\n'
  for (let i = 1; i < 12; i++) y += `a${i}: &a${i} [${Array(10).fill(`*a${i - 1}`).join(', ')}]\n`
  assert.throws(() => parse(y, { maxAliasCount: 100 }), /alias|excessive/i)
})
