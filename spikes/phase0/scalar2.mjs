import { dereference, validate } from '@scalar/openapi-parser'
const j = (v) => JSON.stringify(v, null, 1)
const vbad = await validate({ openapi: '3.1.0', info: { title: 't' }, paths: { '/a': { get: {} } } })
console.log('bad:', vbad.valid, j(vbad.errors))
const vbad2 = await validate({ openapi: '3.0.3', info: { title: 't', version: '1' }, paths: { '/a': { get: { responses: { '200': { description: 5 } } } } } })
console.log('bad2:', vbad2.valid, j(vbad2.errors))
const vbad3 = await validate({ openapi: '3.1.0', info: { title: 't', version: '1' }, paths: { '/a': { get: { responses: { '200': { description: 'x', content: { 'application/json': { schema: { type: 'strng' } } } } } } } } })
console.log('bad3 (invalid schema type):', vbad3.valid, j(vbad3.errors))
// circular
const circ = { openapi: '3.1.0', info: { title: 't', version: '1' }, paths: { '/a': { get: { responses: { '200': { description: 'x', content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } } } } } },
  components: { schemas: { Node: { type: 'object', properties: { child: { $ref: '#/components/schemas/Node' } } } } } }
const r = await dereference(circ)
console.log('circ errors', j(r.errors))
const s = r.schema.paths['/a'].get.responses['200'].content['application/json'].schema
console.log('schema keys', Object.keys(s), 'self-ref?', s.properties.child === s, 'depth:', s.properties.child?.properties?.child === s ? 'cyclic' : 'other')
try { console.log(JSON.stringify(s).length) } catch (e) { console.log('JSON.stringify of derefed circular:', e.message) }
// broken local ref
const broken = structuredClone(circ); broken.components.schemas.Node.properties.child = { $ref: '#/components/schemas/Missing' }
const rb = await dereference(broken); console.log('broken errors', j(rb.errors))
// sibling keywords next to $ref (3.1)
const sib = structuredClone(circ); sib.components.schemas.Node = { type: 'object', properties: { child: { $ref: '#/components/schemas/Str', description: 'override', maxLength: 3 } } }; sib.components.schemas.Str = { type: 'string' }
const rs = await dereference(sib); console.log('siblings', j(rs.schema.components.schemas.Node.properties.child))
// $ref with $defs / $id / $anchor (3.1 JSON Schema features)
const defs = { openapi: '3.1.0', info: { title: 't', version: '1' }, paths: {}, components: { schemas: { A: { $defs: { X: { type: 'integer' } }, type: 'object', properties: { x: { $ref: '#/components/schemas/A/$defs/X' } } } } } }
const rd = await dereference(defs); console.log('defs', j(rd.errors), j(rd.schema.components.schemas.A.properties))
