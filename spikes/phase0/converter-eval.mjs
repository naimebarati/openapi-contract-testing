// Evaluates @openapi-contrib/openapi-schema-to-json-schema (path A) against OAS 3.0 ground truth.
import convert from '@openapi-contrib/openapi-schema-to-json-schema'
import Ajv04 from 'ajv-draft-04'
const fn = convert.default ?? convert.fromSchema ?? convert
const conv = typeof fn === 'function' ? fn : convert.fromSchema
const cases = [
  { name: 'nullable string accepts null', schema: { type: 'string', nullable: true }, ok: [null, 'a'], bad: [1] },
  { name: 'nullable:false rejects null', schema: { type: 'string', nullable: false }, ok: ['a'], bad: [null] },
  { name: 'nullable+enum without null in enum rejects null (OAS 3.0.3 clarification)', schema: { type: 'string', nullable: true, enum: ['a', 'b'] }, ok: ['a'], bad: [null, 'c'] },
  { name: 'nullable+enum with null accepts null', schema: { type: 'string', nullable: true, enum: ['a', null] }, ok: ['a', null], bad: ['c'] },
  { name: 'exclusiveMinimum boolean', schema: { type: 'number', minimum: 5, exclusiveMinimum: true }, ok: [5.1], bad: [5, 4] },
  { name: 'exclusiveMaximum boolean', schema: { type: 'integer', maximum: 5, exclusiveMaximum: true }, ok: [4], bad: [5] },
  { name: 'nested nullable in properties named "nullable"', schema: { type: 'object', properties: { nullable: { type: 'boolean' } }, required: ['nullable'] }, ok: [{ nullable: true }], bad: [{}, { nullable: null }] },
  { name: 'property named "example" / "readOnly" is data not keyword', schema: { type: 'object', properties: { example: { type: 'string' }, readOnly: { type: 'integer' } } }, ok: [{ example: 'x', readOnly: 1 }], bad: [{ example: 1 }] },
  { name: 'oneOf with nullable member', schema: { oneOf: [{ type: 'string', nullable: true }, { type: 'integer' }] }, ok: [null, 'a', 1], bad: [true] },
  { name: 'additionalProperties schema', schema: { type: 'object', additionalProperties: { type: 'integer' } }, ok: [{ a: 1 }], bad: [{ a: 'x' }] },
  { name: 'items nullable', schema: { type: 'array', items: { type: 'integer', nullable: true } }, ok: [[1, null]], bad: [[ 'a' ]] },
  { name: 'nullable without type (3.0.3: no effect)', schema: { nullable: true, minimum: 1 }, ok: [2], bad: [0] },
  { name: 'format unknown is allowed (3.0 open format)', schema: { type: 'string', format: 'my-custom-format' }, ok: ['x'], bad: [] },
  { name: 'discriminator/xml/externalDocs/example dropped but not fatal', schema: { type: 'object', example: {}, xml: { name: 'x' }, externalDocs: { url: 'http://x' }, discriminator: { propertyName: 'a' } }, ok: [{}], bad: [1] },
]
let pass = 0, fail = 0
for (const c of cases) {
  let out; let errs = []
  try {
    out = conv(structuredClone(c.schema))
    const ajv = new Ajv04({ strict: false, allErrors: true }) // strict:false: converter leaks unknown keywords
    const v = ajv.compile(out)
    for (const x of c.ok) if (!v(x)) errs.push(`should accept ${JSON.stringify(x)}`)
    for (const x of c.bad) if (v(x)) errs.push(`should reject ${JSON.stringify(x)}`)
  } catch (e) { errs.push('threw: ' + e.message) }
  errs.length ? (fail++, console.log('FAIL', c.name, errs, JSON.stringify(out))) : (pass++, console.log('ok  ', c.name))
}
console.log({ pass, fail })
