export type ScalarType = 'string' | 'integer' | 'number' | 'boolean';

export type ScalarParse =
  { ok: true; value: string | number | boolean } | { ok: false; reason: string };

const INTEGER = /^-?(?:0|[1-9]\d*)$/;
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * Strictly converts header or text values to the JSON type their schema declares. No lenient coercion:
 * `""` is not `0` and `"yes"` is not `true`.
 */
export function parseScalar(text: string, type: ScalarType): ScalarParse {
  switch (type) {
    case 'string':
      return { ok: true, value: text };
    case 'integer':
      return INTEGER.test(text)
        ? { ok: true, value: Number(text) }
        : { ok: false, reason: 'an integer' };
    case 'number':
      return NUMBER.test(text)
        ? { ok: true, value: Number(text) }
        : { ok: false, reason: 'a number' };
    case 'boolean':
      if (text === 'true') return { ok: true, value: true };
      if (text === 'false') return { ok: true, value: false };
      return { ok: false, reason: '"true" or "false"' };
  }
}

export type ValueSpec =
  | { kind: 'any' }
  | { kind: 'scalar'; type: ScalarType }
  | { kind: 'array'; item: ScalarType }
  | { kind: 'unsupported'; reason: string };

const SCALAR_TYPES = new Set<string>(['string', 'integer', 'number', 'boolean']);
const COMBINATORS = ['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else'];

function scalarTypeOf(node: Record<string, unknown>): ScalarType | { reason: string } {
  const raw = node['type'];
  if (raw === undefined) {
    if (COMBINATORS.some((key) => key in node))
      return { reason: 'the schema uses composition keywords without a type' };
    const values = Array.isArray(node['enum'])
      ? (node['enum'] as unknown[])
      : 'const' in node
        ? [node['const']]
        : [];
    if (values.length > 0 && values.every((v) => typeof v === 'string')) return 'string';
    if (values.length > 0)
      return { reason: 'enum/const values that are not strings need an explicit type' };
    return 'string';
  }
  const types = (Array.isArray(raw) ? (raw as unknown[]) : [raw]).filter((t) => t !== 'null');
  if (types.length !== 1) return { reason: 'union types are not supported' };
  const only = types[0];
  if (typeof only === 'string' && SCALAR_TYPES.has(only)) return only as ScalarType;
  return { reason: `type "${String(only)}" cannot be represented as text` };
}

/** Derives how a header value or text body is converted from the (already `$ref`-resolved) schema. */
export function valueSpecFor(schema: unknown, peekItems: (items: unknown) => unknown): ValueSpec {
  if (schema === undefined) return { kind: 'any' };
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    return { kind: 'unsupported', reason: 'the schema is not an object' };
  }
  const node = schema as Record<string, unknown>;
  if (node['type'] === 'array') {
    const items = peekItems(node['items']);
    if (typeof items !== 'object' || items === null || Array.isArray(items)) {
      return { kind: 'unsupported', reason: 'array items must be a schema' };
    }
    const item = scalarTypeOf(items as Record<string, unknown>);
    return typeof item === 'string'
      ? { kind: 'array', item }
      : { kind: 'unsupported', reason: `array items: ${item.reason}` };
  }
  const scalar = scalarTypeOf(node);
  return typeof scalar === 'string'
    ? { kind: 'scalar', type: scalar }
    : { kind: 'unsupported', reason: scalar.reason };
}
