import { OpenApiInputError } from '../diagnostics/errors.js';
import type { HeadersLike } from '../public-types.js';

/** Case-insensitive header collection that keeps repeated headers (for example `Set-Cookie`) as separate values. */
export class HeaderBag {
  private readonly map = new Map<string, string[]>();

  add(name: string, value: string): void {
    const key = name.toLowerCase();
    const values = this.map.get(key);
    if (values) values.push(value);
    else this.map.set(key, [value]);
  }

  has(name: string): boolean {
    return this.map.has(name.toLowerCase());
  }

  /** All values in arrival order, or `undefined` when the header is absent. */
  getAll(name: string): readonly string[] | undefined {
    return this.map.get(name.toLowerCase());
  }

  first(name: string): string | undefined {
    return this.map.get(name.toLowerCase())?.[0];
  }
}

const EMPTY = new HeaderBag();
export function emptyHeaders(): HeaderBag {
  return EMPTY;
}

function isIterable(value: object): value is Iterable<unknown> {
  return typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function';
}

/**
 * Converts the header shapes produced by common HTTP clients (Fetch `Headers`, Node's plain objects,
 * entry lists) into a `HeaderBag` without modifying the input.
 */
export function toHeaderBag(headers: HeadersLike | undefined, where: string): HeaderBag {
  if (headers === undefined) return EMPTY;
  const candidate: unknown = headers;
  if (typeof candidate !== 'object' || candidate === null) {
    throw new OpenApiInputError(
      `${where}.headers must be a Headers instance, an object or a list of [name, value] pairs.`,
    );
  }
  const bag = new HeaderBag();
  if (isIterable(headers)) {
    for (const entry of headers as Iterable<unknown>) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') {
        throw new OpenApiInputError(`${where}.headers entries must be [name, value] pairs.`);
      }
      const value: unknown = entry[1];
      if (Array.isArray(value)) for (const item of value) addValue(bag, entry[0], item, where);
      else addValue(bag, entry[0], value, where);
    }
    return bag;
  }
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) addValue(bag, name, item, where);
    else addValue(bag, name, value, where);
  }
  return bag;
}

function addValue(bag: HeaderBag, name: string, value: unknown, where: string): void {
  if (typeof value === 'string') bag.add(name, value);
  else if (typeof value === 'number' && Number.isFinite(value)) bag.add(name, String(value));
  else if (value === undefined) return;
  else
    throw new OpenApiInputError(
      `${where}.headers["${name}"] must be a string, number or array of strings.`,
    );
}

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token',
  'x-amz-security-token',
  'www-authenticate',
]);

export function isSensitiveHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_HEADERS.has(lower) || /(?:token|secret|password|api[-_]?key)/.test(lower);
}
