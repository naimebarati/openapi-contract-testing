import { DocumentSet, SchemaRegistry, buildAjv } from './proto.mjs'
const N = 1000
const comps = {}
for (let i = 0; i < 200; i++) comps[`M${i}`] = { type: 'object', required: ['id'], properties: { id: { type: 'integer' }, name: { type: 'string', nullable: true }, email: { type: 'string', format: 'email' }, next: { $ref: `#/components/schemas/M${(i + 1) % 200}` }, tags: { type: 'array', items: { type: 'string' } } } }
const docs = new DocumentSet({ rootDir: '.' }); docs.addRoot('root', { components: { schemas: comps } }, '.')
for (const dialect of ['3.0', '3.1']) {
  const t0 = performance.now()
  const reg = new SchemaRegistry(docs, { dialect })
  const refs = []
  for (let i = 0; i < N; i++) refs.push(await reg.entry({ $ref: `#/components/schemas/M${i % 200}` }, { docKey: 'root', pointer: '/x' }))
  const t1 = performance.now()
  const ajv = buildAjv(dialect); ajv.addSchema({ definitions: reg.defs }, 'urn:oct:registry')
  const vs = refs.map((r) => ajv.getSchema(r))
  const t2 = performance.now()
  const data = { id: 1, name: null, email: 'a@b.co', tags: ['a'], next: { id: 2, email: 'c@d.co' } }
  let okc = 0
  const t3 = performance.now()
  for (let i = 0; i < 10000; i++) okc += vs[i % N](data) ? 1 : 0
  const t4 = performance.now()
  console.log(`${dialect}: transform ${N} entries ${(t1 - t0).toFixed(0)}ms, compile ${(t2 - t1).toFixed(0)}ms, 10k validations ${(t4 - t3).toFixed(0)}ms (valid ${okc}), registry defs ${Object.keys(reg.defs).length}`)
}
