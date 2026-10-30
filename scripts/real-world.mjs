// Developer tool: runs the package against a real-world OpenAPI document (not part of the test suite or CI).
//
//   npm run build && node --max-old-space-size=4096 scripts/real-world.mjs <spec.json|yaml> [--limit 400]
//
// 1. Loads the document with generous limits (policy 'warning', so unsupported features are listed, not fatal).
// 2. For every JSON response of the first N operations it builds an instance from the schema (required
//    properties only) and expects "valid"; failures are false positives or generator limits to inspect.
// 3. It then changes the type of one required property and expects "invalid" (false-negative check).
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { loadOpenApiContract } from '../dist/index.js';

const file = process.argv[2];
const limitAt = process.argv.indexOf('--limit');
const limit = limitAt === -1 ? 400 : Number(process.argv[limitAt + 1]);
const verbose = process.argv.includes('--verbose');
const onlyAt = process.argv.indexOf('--only');
const only = onlyAt === -1 ? undefined : process.argv[onlyAt + 1];
if (!file) throw new Error('usage: real-world.mjs <spec> [--limit N]');

const heap = () => Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
const started = performance.now();
let contract;
try {
  contract = await loadOpenApiContract({
    source: file,
    validation: { unsupportedFeaturePolicy: 'warning', maxBodyBytes: 64 * 1024 * 1024 },
    routing: { basePath: '/' },
  });
} catch (error) {
  console.log(
    JSON.stringify({
      file,
      loaded: false,
      loadMs: Math.round(performance.now() - started),
      error: `${error.name}: ${String(error.message).slice(0, 600)}`,
      issues: (error.issues ?? [])
        .slice(0, 5)
        .map((i) => `${i.code} ${i.schemaPath ?? ''} ${i.message.slice(0, 200)}`),
    }),
  );
  process.exit(0);
}
const loadMs = Math.round(performance.now() - started);
const warnings = {};
for (const w of contract.getWarnings()) {
  const key = `${w.code}: ${w.message
    .replace(/\(.*$/s, '')
    .replace(/"[^"]*"/g, '"…"')
    .slice(0, 110)}`;
  warnings[key] = (warnings[key] ?? 0) + 1;
}

// ---------------------------------------------------------------- instance generator (independent of the package)
const text = readFileSync(file, 'utf8');
const doc = file.endsWith('.json') ? JSON.parse(text) : (await import('yaml')).parse(text);
const resolveLocal = (ref) => {
  if (!ref.startsWith('#/')) return undefined;
  let cur = doc;
  for (const part of ref.slice(2).split('/')) {
    cur = cur?.[decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return cur;
};
const FORMATS = {
  'date-time': '2020-01-01T00:00:00Z',
  date: '2020-01-01',
  email: 'a@b.co',
  uuid: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  uri: 'http://example.com',
  url: 'http://example.com',
  hostname: 'example.com',
  ipv4: '1.2.3.4',
  ipv6: '::1',
  byte: 'AAAA',
  binary: 'x',
  password: 'x',
  time: '00:00:00Z',
  'uri-reference': 'a',
  duration: 'P1D',
};
class Incomplete extends Error {}
function gen(schema, seen = new Map(), depth = 0, inheritedRequired = []) {
  if (depth > 12) throw new Incomplete('depth');
  if (schema === true || schema === undefined) return {};
  if (typeof schema !== 'object' || schema === null) throw new Incomplete('bad schema');
  if (schema.$ref) {
    const target = resolveLocal(schema.$ref);
    if (target === undefined) throw new Incomplete(`unresolved ${schema.$ref}`);
    const count = seen.get(schema.$ref) ?? 0;
    if (count >= 2) throw new Incomplete('recursion');
    const next = new Map(seen).set(schema.$ref, count + 1);
    return gen(target, next, depth + 1, inheritedRequired);
  }
  if (schema.if !== undefined) throw new Incomplete('conditional (if/then/else is not generated)');
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length)
    return schema.enum.find((v) => v !== null) ?? schema.enum[0];
  if (schema.allOf) {
    // `required` may sit next to allOf while the properties live in the members (very common): share it.
    const shared = [
      ...new Set([
        ...inheritedRequired,
        ...(schema.required ?? []),
        ...schema.allOf.flatMap((m) =>
          m.$ref ? (resolveLocal(m.$ref)?.required ?? []) : (m.required ?? []),
        ),
      ]),
    ];
    const parts = schema.allOf.map((m) => gen(m, seen, depth + 1, shared));
    if (parts.every((p) => p && typeof p === 'object' && !Array.isArray(p))) {
      const base = gen(
        { ...schema, allOf: undefined, type: schema.type ?? 'object' },
        seen,
        depth + 1,
        shared,
      );
      return Object.assign(
        {},
        typeof base === 'object' && base && !Array.isArray(base) ? base : {},
        ...parts,
      );
    }
    return parts[0];
  }
  for (const key of ['oneOf', 'anyOf']) {
    if (schema[key]) {
      for (const [i, member] of schema[key].entries()) {
        try {
          const value = gen(member, seen, depth + 1);
          const property = schema.discriminator?.propertyName;
          const declared = (member.$ref ? resolveLocal(member.$ref) : member)?.properties?.[
            property
          ];
          const fixedByVariant =
            declared && (declared.enum || declared.const !== undefined || declared.$ref);
          if (
            property &&
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            !fixedByVariant
          ) {
            const mapping = Object.entries(schema.discriminator.mapping ?? {}).find(
              ([, ref]) => ref === member.$ref || ref === member.$ref?.split('/').pop(),
            );
            value[property] = mapping
              ? mapping[0]
              : (member.$ref?.split('/').pop() ?? value[property]);
          }
          return value;
        } catch (e) {
          if (!(e instanceof Incomplete) || i === schema[key].length - 1) throw e;
        }
      }
    }
  }
  let type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  if (!type) type = schema.properties ? 'object' : schema.items ? 'array' : undefined;
  if (!type) return {};
  switch (type) {
    case 'string': {
      if (schema.pattern) throw new Incomplete('pattern');
      let s = FORMATS[schema.format] ?? 'a';
      if (schema.minLength && s.length < schema.minLength) s = s.padEnd(schema.minLength, 'a');
      if (schema.maxLength && s.length > schema.maxLength) s = s.slice(0, schema.maxLength);
      return s;
    }
    case 'integer':
    case 'number': {
      let n = typeof schema.minimum === 'number' ? schema.minimum : 0;
      if (schema.exclusiveMinimum === true) n += 1;
      else if (typeof schema.exclusiveMinimum === 'number') n = schema.exclusiveMinimum + 1;
      if (typeof schema.maximum === 'number' && n > schema.maximum) n = schema.maximum;
      if (schema.multipleOf) n = Math.ceil(n / schema.multipleOf) * schema.multipleOf;
      return n;
    }
    case 'boolean':
      return true;
    case 'array':
      return Array.from({ length: schema.minItems ?? 0 }, () => gen(schema.items, seen, depth + 1));
    case 'object': {
      const out = {};
      for (const name of [...new Set([...(schema.required ?? []), ...inheritedRequired])]) {
        const prop = schema.properties?.[name];
        if (prop === undefined) {
          // Unknown here: a sibling allOf member may define it; otherwise a placeholder.
          if (!schema.allOf && !inheritedRequired.includes(name)) out[name] = 'x';
          continue;
        }
        const resolved = prop.$ref ? resolveLocal(prop.$ref) : prop;
        if (resolved?.writeOnly) continue;
        out[name] = gen(prop, seen, depth + 1);
      }
      return out;
    }
    default:
      throw new Incomplete(`type ${type}`);
  }
}
const wrongType = (value) =>
  typeof value === 'string'
    ? 12345
    : typeof value === 'number'
      ? 'text'
      : typeof value === 'boolean'
        ? 'text'
        : undefined;

// ---------------------------------------------------------------- run
const stats = {
  operations: contract.getOperations().length,
  scanned: 0,
  instances: 0,
  validOk: 0,
  validBad: 0,
  skipped: {},
  mutated: 0,
  caught: 0,
  missed: 0,
};
const falsePositives = {};
const samples = [];
const missedSamples = [];
const ops = contract.getOperations().filter((_, i) => i < limit);
const skip = (why) => (stats.skipped[why] = (stats.skipped[why] ?? 0) + 1);

for (const op of ops) {
  stats.scanned++;
  const pathItem = doc.paths?.[op.path];
  const operation =
    pathItem?.[op.method.toLowerCase()] ?? pathItem?.additionalOperations?.[op.method];
  if (!operation?.responses) {
    skip('no-raw-operation');
    continue;
  }
  if (op.path.includes('#')) {
    skip('fragment-in-path');
    continue;
  } // a client never sends the fragment
  const url = op.path.replace(/\{[^}]+\}/g, '1');
  for (const key of op.responses) {
    if (key === 'default') continue;
    const status = /^\d{3}$/.test(key) ? Number(key) : Number(key[0]) * 100 + 1;
    let response = operation.responses[key];
    if (response?.$ref) response = resolveLocal(response.$ref);
    const media = Object.entries(response?.content ?? {}).find(([m]) =>
      /^application\/(json|[\w.+-]*\+json)$/.test(m),
    );
    if (!media) {
      skip('no-json-media');
      continue;
    }
    const [mediaType, mediaObject] = media;
    let body;
    try {
      body = mediaObject.schema === undefined ? {} : gen(mediaObject.schema);
    } catch (e) {
      if (e instanceof Incomplete) {
        skip(`generator:${e.message.split(' ')[0]}`);
        continue;
      }
      throw e;
    }
    const headers = { 'content-type': mediaType };
    for (const [name, header] of Object.entries(response.headers ?? {})) {
      const h = header?.$ref ? resolveLocal(header.$ref) : header;
      if (h?.required) {
        try {
          headers[name.toLowerCase()] = String(gen(h.schema ?? { type: 'string' }));
        } catch {
          headers[name.toLowerCase()] = '1';
        }
      }
    }
    const exchange = { request: { method: op.method, url }, response: { status, headers, body } };
    stats.instances++;
    const result = contract.validateResponse(exchange);
    if (only && `${op.method} ${op.path} ${key}` === only)
      console.error(
        JSON.stringify(
          {
            body,
            errors: result.errors.map((e) => [e.instancePath, e.keyword, e.schemaPath, e.message]),
          },
          null,
          1,
        ).slice(0, 4000),
      );
    if (result.valid) stats.validOk++;
    else {
      stats.validBad++;
      const first = result.errors[0];
      const k = `${first.code}/${first.keyword ?? ''}`;
      falsePositives[k] = (falsePositives[k] ?? 0) + 1;
      if (samples.length < 8)
        samples.push({
          op: `${op.method} ${op.path} ${key}`,
          code: first.code,
          keyword: first.keyword,
          at: first.instancePath,
          schemaPath: first.schemaPath,
          message: first.message.slice(0, 160),
        });
      continue;
    }
    // mutation: wrong type for one required top-level property
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const name = Object.keys(body).find((n) => wrongType(body[n]) !== undefined);
      if (name !== undefined) {
        stats.mutated++;
        const bad = {
          ...exchange,
          response: { ...exchange.response, body: { ...body, [name]: wrongType(body[name]) } },
        };
        const r = contract.validateResponse(bad);
        if (!r.valid) stats.caught++;
        else {
          stats.missed++;
          if (missedSamples.length < 5)
            missedSamples.push(`${op.method} ${op.path} ${key} property ${name}`);
        }
      }
    }
  }
}
console.log(
  JSON.stringify({
    file: file.split('/').slice(-2).join('/'),
    openapi: doc.openapi,
    loaded: true,
    loadMs,
    heapMbAfterLoad: heap(),
    rssMbAtEnd: Math.round(process.memoryUsage().rss / 1024 / 1024),
    warnings,
    stats,
    falsePositives,
    samples: verbose ? samples : samples.slice(0, 4),
    missedSamples,
  }),
);
