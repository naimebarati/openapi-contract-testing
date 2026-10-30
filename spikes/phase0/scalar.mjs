import { dereference, validate } from '@scalar/openapi-parser'
import { bundle } from '@scalar/json-magic/bundle'
import { readFiles, parseYaml, parseJson } from '@scalar/json-magic/bundle/plugins/node'
import { resolve } from 'node:path'

const show = (t, v) => console.log(`\n### ${t}\n`, typeof v === 'string' ? v : JSON.stringify(v, null, 1)?.slice(0, 1500))

// 1. split file bundle, no basePath → does it read ../../outside?
const file = resolve('fixtures/split/openapi.yaml')
const b1 = await bundle(file, { plugins: [readFiles(), parseYaml(), parseJson()] }).catch(e => ({ thrown: String(e) }))
show('bundle (no basePath) keys', Object.keys(b1))
show('bundle (no basePath) $ref in user schema', b1?.paths?.['/users/{id}']?.get?.responses?.['200']?.content?.['application/json']?.schema)
show('bundle x-ext', Object.keys(b1?.['x-ext'] ?? {}))

// 2. with basePath confinement
const b2 = await bundle(file, { plugins: [readFiles({ basePath: resolve('fixtures/split') }), parseYaml(), parseJson()] }).catch(e => ({ thrown: String(e) }))
show('bundle (basePath) x-ext', Object.keys(b2?.['x-ext'] ?? {}))
show('bundle (basePath) schema', b2?.['x-ext']?.['schemas/user.yaml'])

// 3. dereference: circular
const d = await dereference(b2)
show('dereference errors', d.errors)
const node = d.schema?.paths?.['/users/{id}']?.get?.responses?.['201']?.content?.['application/json']?.schema
show('circular identical object?', node?.properties?.children?.items === node)

// 4. mutation of input
const input = { openapi: '3.1.0', info: { title: 't', version: '1' }, paths: { '/a': { get: { responses: { '200': { description: 'x', content: { 'application/json': { schema: { $ref: '#/components/schemas/A' } } } } } } } }, components: { schemas: { A: { type: 'string' } } } }
const snap = JSON.stringify(input)
const r = await dereference(input)
show('input mutated by dereference?', JSON.stringify(input) !== snap)
show('result same object as input?', r.schema === input)

// 5. validate on bad/3.2 docs
const v32 = await validate({ openapi: '3.2.0', info: { title: 't', version: '1' }, paths: { '/a': { query: { responses: { '200': { description: 'ok' } } } } } })
show('validate 3.2 w/ QUERY method', v32)
const vbad = await validate({ openapi: '3.1.0', info: { title: 't' }, paths: { '/a': { get: {} } } })
show('validate invalid', vbad.errors)
const vunknown = await validate({ openapi: '4.0.0', info: { title: 't', version: '1' }, paths: {} })
show('validate unknown version', vunknown.errors)
