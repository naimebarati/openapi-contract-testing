import { Validator } from '@seriousme/openapi-schema-validator'
const j = (v) => JSON.stringify(v, null, 1)
console.log('supported', [...Validator.supportedVersions])
const cases = {
  '3.1 missing info.version + get:{}': { openapi: '3.1.0', info: { title: 't' }, paths: { '/a': { get: {} } } },
  '3.1 type strng': { openapi: '3.1.0', info: { title: 't', version: '1' }, paths: { '/a': { get: { responses: { '200': { description: 'x', content: { 'application/json': { schema: { type: 'strng' } } } } } } } } },
  '3.0 desc number': { openapi: '3.0.3', info: { title: 't', version: '1' }, paths: { '/a': { get: { responses: { '200': { description: 5 } } } } } },
  '3.2 QUERY ok': { openapi: '3.2.0', info: { title: 't', version: '1' }, paths: { '/a': { query: { responses: { '200': { description: 'ok' } } } } } },
  '3.1 QUERY (not allowed key)': { openapi: '3.1.0', info: { title: 't', version: '1' }, paths: { '/a': { query: { responses: { '200': { description: 'ok' } } } } } },
  '4.0': { openapi: '4.0.0', info: { title: 't', version: '1' }, paths: {} },
  'ok 3.1': { openapi: '3.1.0', info: { title: 't', version: '1' }, paths: {} },
  '3.1 webhooks only (no paths)': { openapi: '3.1.0', info: { title: 't', version: '1' }, webhooks: {} },
}
for (const [k, doc] of Object.entries(cases)) {
  const snap = JSON.stringify(doc)
  const v = new Validator()
  const r = await v.validate(doc)
  console.log(`\n## ${k}: valid=${r.valid} version=${v.version} mutated=${JSON.stringify(doc) !== snap}`)
  if (!r.valid) console.log(j(r.errors)?.slice(0, 700))
}
