/** JSON type name of a value, `integer` distinguished from `number`. */
export function jsonTypeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'object') return 'object';
  return typeof value;
}

/** Reads the value at a JSON Pointer (RFC 6901), or `undefined` when it does not exist. */
export function getByPointer(root: unknown, pointer: string): unknown {
  if (pointer === '') return root;
  let current = root;
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current)) current = current[Number(key)];
    else if (typeof current === 'object' && current !== null && Object.hasOwn(current, key)) {
      current = (current as Record<string, unknown>)[key];
    } else return undefined;
  }
  return current;
}

const MAX_STRING = 120;
const MAX_ITEMS = 10;
const MAX_DEPTH = 3;

/** Bounded copy of a value for diagnostics; never used unless the user opted in to actual values. */
export function truncateValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}… (${value.length} chars)`
      : value;
  }
  if (typeof value !== 'object' || value === null) return value;
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? `[array(${value.length})]` : '[object]';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((item) => truncateValue(item, depth + 1));
    return value.length > MAX_ITEMS ? [...items, `… ${value.length - MAX_ITEMS} more`] : items;
  }
  const entries = Object.entries(value);
  const copy: Record<string, unknown> = {};
  for (const [key, item] of entries.slice(0, MAX_ITEMS)) copy[key] = truncateValue(item, depth + 1);
  if (entries.length > MAX_ITEMS) copy['…'] = `${entries.length - MAX_ITEMS} more`;
  return copy;
}
