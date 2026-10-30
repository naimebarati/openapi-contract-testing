export interface ParsedMediaType {
  type: string;
  subtype: string;
  /** Structured syntax suffix, e.g. `json` for `application/problem+json`. */
  suffix: string | undefined;
  params: Readonly<Record<string, string>>;
  /** `type/subtype`, lower-cased, without parameters. */
  essence: string;
}

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Parses a Content-Type value or a media type key of a contract. Returns `undefined` when malformed. */
export function parseMediaType(input: string): ParsedMediaType | undefined {
  const [head, ...rest] = splitOutsideQuotes(input, ';');
  const [type, subtype, ...extra] = (head ?? '').trim().split('/');
  if (!type || !subtype || extra.length > 0 || !TOKEN.test(type) || !TOKEN.test(subtype))
    return undefined;

  const params: Record<string, string> = {};
  for (const raw of rest) {
    const text = raw.trim();
    if (text === '') continue;
    const eq = text.indexOf('=');
    if (eq <= 0) return undefined;
    const name = text.slice(0, eq).trim().toLowerCase();
    let value = text.slice(eq + 1).trim();
    if (!TOKEN.test(name)) return undefined;
    if (value.startsWith('"')) {
      if (value.length < 2 || !value.endsWith('"')) return undefined;
      value = value.slice(1, -1).replace(/\\(.)/g, '$1');
    } else if (!TOKEN.test(value)) {
      return undefined;
    }
    params[name] = name === 'charset' ? value.toLowerCase() : value;
  }
  const lowerType = type.toLowerCase();
  const lowerSubtype = subtype.toLowerCase();
  const plus = lowerSubtype.lastIndexOf('+');
  return {
    type: lowerType,
    subtype: lowerSubtype,
    suffix: plus > 0 ? lowerSubtype.slice(plus + 1) : undefined,
    params,
    essence: `${lowerType}/${lowerSubtype}`,
  };
}

function splitOutsideQuotes(input: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i] as string;
    if (char === '"' && input[i - 1] !== '\\') quoted = !quoted;
    if (char === separator && !quoted) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/** `application/json` and any `+json` type. `application/problem+json` is JSON but is not `application/json`. */
export function isJsonMediaType(mediaType: ParsedMediaType): boolean {
  return mediaType.essence === 'application/json' || mediaType.suffix === 'json';
}

export function isTextMediaType(mediaType: ParsedMediaType): boolean {
  return mediaType.type === 'text';
}

export function isXmlMediaType(mediaType: ParsedMediaType): boolean {
  return (
    mediaType.essence === 'application/xml' ||
    mediaType.essence === 'text/xml' ||
    mediaType.suffix === 'xml'
  );
}

export interface MediaTypeCandidate<T> {
  range: ParsedMediaType;
  value: T;
}

/**
 * Picks the contract media type for an actual Content-Type: exact match, then `type/*`, then the full wildcard.
 * Parameters written in the contract (for example `charset`) must match. `+json` types are never
 * treated as `application/json`; the contract has to list them or use a wildcard.
 */
export function selectMediaType<T>(
  actual: ParsedMediaType,
  candidates: readonly MediaTypeCandidate<T>[],
): MediaTypeCandidate<T> | undefined {
  let best: { candidate: MediaTypeCandidate<T>; score: number } | undefined;
  for (const candidate of candidates) {
    const { range } = candidate;
    let score: number;
    if (range.type === actual.type && range.subtype === actual.subtype) score = 3;
    else if (range.type === actual.type && range.subtype === '*') score = 2;
    else if (range.type === '*' && range.subtype === '*') score = 1;
    else continue;
    const paramNames = Object.keys(range.params);
    if (paramNames.some((name) => range.params[name] !== actual.params[name])) continue;
    score = score * 100 + paramNames.length;
    if (!best || score > best.score) best = { candidate, score };
  }
  return best?.candidate;
}
