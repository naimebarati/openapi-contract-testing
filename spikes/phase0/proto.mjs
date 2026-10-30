// Phase 0 prototype: proves the pipeline chosen in docs/adr (not production code).
//
//   YAML/JSON text --yaml--> object --official OAS schemas--> structural validation
//   Schema Objects --position-aware transform (own code)--> registry of definitions --Ajv (draft-04 | 2020-12)
//
// $ref handling: Reference Objects outside Schema Objects are resolved by us; Schema Object $refs are
// rewritten into pointers into a per-contract registry so Ajv handles cycles and $ref siblings natively.
import { open, realpath } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import Ajv04 from 'ajv-draft-04'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

export class SpikeError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const REG = 'urn:oct:registry'
const SCHEMA_KEYS = new Set(['items', 'additionalProperties', 'not', 'contains', 'propertyNames', 'if', 'then', 'else', 'unevaluatedItems', 'unevaluatedProperties', 'contentSchema'])
const SCHEMA_ARRAYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])
const SCHEMA_MAPS = new Set(['properties', 'patternProperties', '$defs', 'dependentSchemas'])
const PASSTHROUGH = new Set([
  'type', 'enum', 'const', 'required', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties',
  'dependentRequired', 'minContains', 'maxContains', 'title', 'description', 'default', 'example', 'examples',
  'deprecated', 'readOnly', 'writeOnly', 'xml', 'externalDocs', 'contentEncoding', 'contentMediaType',
])
const UNSUPPORTED_REF_KEYS = ['$id', '$anchor', '$dynamicRef', '$dynamicAnchor', '$recursiveRef', '$recursiveAnchor', '$vocabulary']

/** Reads and confines external files; every failure carries a structured code. */
export class DocumentSet {
  constructor({ rootDir, maxFiles = 50, maxBytesPerFile = 5 * 1024 * 1024 }) {
    this.rootDir = rootDir
    this.maxFiles = maxFiles
    this.maxBytes = maxBytesPerFile
    this.docs = new Map() // key -> { data, dir }
  }
  addRoot(key, data, dir) {
    this.docs.set(key, { data, dir })
  }
  async resolveRef(fromKey, ref) {
    const hashAt = ref.indexOf('#')
    const uriPart = hashAt === -1 ? ref : ref.slice(0, hashAt)
    const frag = hashAt === -1 ? '' : ref.slice(hashAt + 1)
    let docKey = fromKey
    if (uriPart !== '') {
      if (/^[a-z][a-z0-9+.-]+:/i.test(uriPart)) {
        throw new SpikeError('reference.not_allowed', `Reference scheme not allowed (remote/file URLs are disabled): ${ref.split(':')[0]}:`)
      }
      let decoded
      try { decoded = decodeURIComponent(uriPart) } catch { throw new SpikeError('reference.not_found', `Malformed reference: ${ref}`) }
      const from = this.docs.get(fromKey)
      docKey = path.resolve(from.dir, decoded)
      await this.load(docKey)
    }
    if (frag !== '' && !frag.startsWith('/')) {
      throw new SpikeError('spec.unsupported_feature', `Plain-name fragment references (anchors) are not supported: ${ref}`)
    }
    return { docKey, pointer: frag === '' ? '' : decodeURIComponent(frag) }
  }
  async load(absPath) {
    if (this.docs.has(absPath)) return
    if (this.docs.size >= this.maxFiles) throw new SpikeError('reference.not_allowed', `Too many referenced files (limit ${this.maxFiles})`)
    let real
    try { real = await realpath(absPath) } catch { throw new SpikeError('reference.not_found', `Referenced file not found: ${path.relative(this.rootDir, absPath)}`) }
    const realRoot = await realpath(this.rootDir)
    const rel = path.relative(realRoot, real)
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new SpikeError('reference.not_allowed', `Reference escapes root directory: ${absPath}`)
    }
    const fh = await open(real, 'r')
    try {
      const { size } = await fh.stat()
      if (size > this.maxBytes) throw new SpikeError('reference.not_allowed', `Referenced file exceeds ${this.maxBytes} bytes`)
      const text = (await fh.readFile()).toString('utf8')
      const data = real.endsWith('.json') ? JSON.parse(text) : parseYaml(text, { maxAliasCount: 100 })
      this.docs.set(absPath, { data, dir: path.dirname(absPath) })
    } finally {
      await fh.close()
    }
  }
  getAt(docKey, pointer) {
    let cur = this.docs.get(docKey).data
    if (pointer === '') return cur
    for (const raw of pointer.slice(1).split('/')) {
      const part = raw.replace(/~1/g, '/').replace(/~0/g, '~')
      if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, part)) {
        throw new SpikeError('reference.not_found', `Reference target not found: ${path.basename(String(docKey))}#${pointer}`)
      }
      cur = cur[part]
    }
    return cur
  }
}

/** Builds one registry of transformed Schema Objects for a single dialect. */
export class SchemaRegistry {
  constructor(docs, { dialect, writeOnlyInResponse = 'error' }) {
    this.docs = docs
    this.dialect = dialect // '3.0' | '3.1'
    this.writeOnlyPolicy = writeOnlyInResponse
    this.ids = new Map() // `${docKey}#${pointer}` -> id
    this.defs = {}
    this.origins = {} // id -> { docKey, pointer }
    this.issues = []
    this.pending = []
  }
  issue(code, message, where) {
    this.issues.push({ code, message, ...where })
  }
  /** Returns a $ref into the registry for the schema at (docKey, pointer). */
  async refTo(docKey, pointer, inherited = new Set()) {
    // allOf members that are $refs are transformed once per distinct set of inherited writeOnly names
    const key = `${docKey}#${pointer}${inherited.size ? `|${[...inherited].sort().join(',')}` : ''}`
    let id = this.ids.get(key)
    if (!id) {
      id = `s${this.ids.size}`
      this.ids.set(key, id)
      this.origins[id] = { docKey, pointer }
      this.defs[id] = true // placeholder breaks cycles
      const node = this.docs.getAt(docKey, pointer)
      this.defs[id] = await this.transform(node, { docKey, pointer }, inherited)
    }
    return `${REG}#/definitions/${id}`
  }
  /** Entry point for an inline schema (e.g. a response media type schema). */
  async entry(node, ctx) {
    const t = await this.transform(node, ctx)
    const id = `e${Object.keys(this.defs).length}`
    this.defs[id] = t
    this.origins[id] = ctx
    return `${REG}#/definitions/${id}`
  }
  async peek(node, ctx, depth = 0) {
    if (node && typeof node === 'object' && typeof node.$ref === 'string' && depth < 20) {
      const t = await this.docs.resolveRef(ctx.docKey, node.$ref)
      return this.peek(this.docs.getAt(t.docKey, t.pointer), t, depth + 1)
    }
    return { node, ctx }
  }
  async writeOnlyNames(node, ctx, seen = new Set(), depth = 0) {
    const names = new Set()
    if (!node || typeof node !== 'object' || depth > 10) return names
    const p = await this.peek(node, ctx)
    const s = p.node
    if (!s || typeof s !== 'object' || seen.has(s)) return names
    seen.add(s)
    for (const [name, prop] of Object.entries(s.properties ?? {})) {
      const pp = await this.peek(prop, { docKey: p.ctx.docKey, pointer: `${p.ctx.pointer}/properties/${name}` })
      if (pp.node?.writeOnly === true) names.add(name)
    }
    for (const m of s.allOf ?? []) for (const n of await this.writeOnlyNames(m, p.ctx, seen, depth + 1)) names.add(n)
    return names
  }
  async transform(node, ctx, inherited = new Set()) {
    const at = `${path.basename(String(ctx.docKey))}#${ctx.pointer}`
    if (typeof node === 'boolean') {
      if (this.dialect === '3.0') this.issue('spec.unsupported_feature', 'Boolean schemas are not valid in OpenAPI 3.0', { at })
      return node
    }
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      throw new SpikeError('spec.invalid', `Schema Object must be an object at ${at}`)
    }
    const out = {}
    let refUrl
    if (typeof node.$ref === 'string') {
      const t = await this.docs.resolveRef(ctx.docKey, node.$ref)
      refUrl = await this.refTo(t.docKey, t.pointer, inherited)
      out.$ref = refUrl
      if (this.dialect === '3.0') {
        // OAS 3.0: siblings of $ref are ignored. Report instead of silently dropping.
        const sib = Object.keys(node).filter((k) => k !== '$ref' && !k.startsWith('x-') && k !== 'description')
        if (sib.length) this.issue('spec.unsupported_feature', `Keywords next to $ref are ignored in OAS 3.0: ${sib.join(', ')}`, { at })
        return out
      }
    }
    for (const k of UNSUPPORTED_REF_KEYS) {
      if (k in node) this.issue('spec.unsupported_feature', `Keyword ${k} is not supported`, { at })
    }
    const own = await this.writeOnlyNames(node, ctx)
    const hidden = new Set([...inherited, ...own])
    const groupHidden = hidden
    for (const [k, v] of Object.entries(node)) {
      const sub = (key) => ({ docKey: ctx.docKey, pointer: `${ctx.pointer}/${key.split('/').map((s) => s.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}` })
      if (k === '$ref' || k.startsWith('x-') || k === '$comment') continue
      if (k === '$schema') {
        if (this.dialect === '3.0') this.issue('spec.unsupported_feature', '$schema is not allowed in OAS 3.0 Schema Objects', { at })
        continue
      }
      if (UNSUPPORTED_REF_KEYS.includes(k)) continue
      if (k === 'nullable') {
        if (this.dialect !== '3.0') this.issue('spec.unsupported_feature', '"nullable" is not a keyword in OAS 3.1+; use type: [T, "null"]', { at })
        continue
      }
      if (k === 'discriminator') continue // handled below
      if (SCHEMA_KEYS.has(k)) {
        out[k] = typeof v === 'boolean' ? v : await this.transform(v, { docKey: ctx.docKey, pointer: `${ctx.pointer}/${k}` })
      } else if (SCHEMA_ARRAYS.has(k)) {
        out[k] = []
        for (let i = 0; i < v.length; i++) {
          out[k].push(await this.transform(v[i], { docKey: ctx.docKey, pointer: `${ctx.pointer}/${k}/${i}` }, k === 'allOf' ? groupHidden : new Set()))
        }
      } else if (SCHEMA_MAPS.has(k)) {
        out[k] = {}
        for (const [name, sch] of Object.entries(v)) {
          if (k === 'properties' && hidden.has(name) && this.writeOnlyPolicy !== 'ignore') {
            out[k][name] = { 'x-oct-write-only': true } // custom keyword fails when the property is present
            continue
          }
          out[k][name] = await this.transform(sch, { docKey: ctx.docKey, pointer: `${ctx.pointer}/${k}/${name.replace(/~/g, '~0').replace(/\//g, '~1')}` })
        }
      } else if (k === 'required') {
        out.required = v.filter((n) => !hidden.has(n))
        if (out.required.length === 0 && this.dialect === '3.0') delete out.required // draft-04: required must be non-empty
      } else if (PASSTHROUGH.has(k)) {
        out[k] = v
      } else {
        this.issue('spec.unsupported_feature', `Unknown/unsupported schema keyword "${k}"`, { at })
      }
    }
    if (this.dialect === '3.0') {
      if (Array.isArray(out.type)) this.issue('spec.invalid', 'type must be a string in OAS 3.0', { at })
      if (node.nullable === true && typeof out.type === 'string') out.type = [out.type, 'null']
    }
    if (node.discriminator && (node.oneOf || node.anyOf)) await this.discriminate(node, out, ctx, at)
    return out
  }
  /** OAS discriminator: validate against the variant selected by the property value, not "exactly one of". */
  async discriminate(node, out, ctx, at) {
    const prop = node.discriminator.propertyName
    const kind = node.oneOf ? 'oneOf' : 'anyOf'
    const mapping = new Map() // value -> variant index
    const variants = node[kind]
    for (const [value, ref] of Object.entries(node.discriminator.mapping ?? {})) {
      const idx = variants.findIndex((v) => v.$ref === ref || v.$ref?.endsWith(`/${ref}`))
      if (idx === -1) { this.issue('spec.unsupported_feature', `discriminator.mapping "${value}" does not match a ${kind} member`, { at }); return }
      mapping.set(value, idx)
    }
    variants.forEach((v, i) => {
      if (typeof v.$ref === 'string' && v.$ref.includes('/components/schemas/')) {
        const name = v.$ref.split('/').pop()
        if (!mapping.has(name) && ![...mapping.values()].includes(i)) mapping.set(name, i)
      }
    })
    if (mapping.size === 0 || [...mapping.values()].length < variants.length && false) {
      this.issue('spec.unsupported_feature', 'discriminator without resolvable mapping; falling back to plain oneOf/anyOf', { at })
      return
    }
    delete out[kind]
    out.required = [...new Set([...(out.required ?? []), prop])]
    out.properties = { ...(out.properties ?? {}), [prop]: { ...(out.properties?.[prop] ?? {}), enum: [...mapping.keys()] } }
    out.allOf = out.allOf ?? []
    const tIdx = (i) => this.transform(variants[i], { docKey: ctx.docKey, pointer: `${ctx.pointer}/${kind}/${i}` })
    for (const [value, i] of mapping) {
      out.allOf.push({ if: { properties: { [prop]: { const: value } }, required: [prop] }, then: await tIdx(i) })
    }
  }
}

const OAS_ANNOTATIONS = ['discriminator', 'xml', 'externalDocs', 'example', 'readOnly', 'writeOnly', 'deprecated', 'title', 'description', 'default', 'examples']

export function buildAjv(dialect, { validateFormats = true, customFormats = {} } = {}) {
  const Ctor = dialect === '3.0' ? Ajv04 : Ajv2020
  const ajv = new Ctor({
    strictSchema: true, // unknown keywords throw instead of being ignored
    strictTypes: false, // `maxLength` without `type` is legal OpenAPI
    strictRequired: false, // `required` listing properties defined in a sibling allOf member is legal and common
    strictTuples: false,
    allErrors: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
    validateFormats,
    allowUnionTypes: true,
    discriminator: false,
  })
  addFormats(ajv)
  for (const [name, f] of Object.entries(customFormats)) ajv.addFormat(name, f)
  for (const kw of OAS_ANNOTATIONS) {
    try { ajv.addKeyword({ keyword: kw }) } catch (e) { if (!/already defined/.test(e.message)) throw e }
  }
  ajv.addKeyword({
    keyword: 'x-oct-write-only',
    validate: function v(_s, data) { return false },
    errors: false,
  })
  return ajv
}
