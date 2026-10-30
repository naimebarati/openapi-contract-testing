import type { BodyInput } from './exchange.js';

export type TextResult = { ok: true; text: string } | { ok: false; reason: string };
export type JsonResult = { ok: true; value: unknown } | { ok: false; reason: string };

/** Decodes a raw body to text. Invalid byte sequences are reported, never replaced silently. */
export function bodyText(body: BodyInput, charset?: string): TextResult {
  if (body.state !== 'raw') return { ok: false, reason: 'no raw body is available' };
  if (body.text !== undefined) return { ok: true, text: body.text };
  const bytes = body.bytes as Uint8Array;
  let label = 'utf-8';
  if (charset !== undefined) {
    try {
      label = new TextDecoder(charset).encoding;
    } catch {
      return { ok: false, reason: `unsupported charset "${charset}"` };
    }
  }
  try {
    return { ok: true, text: new TextDecoder(label, { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, reason: `the body is not valid ${label} text` };
  }
}

/**
 * Parses JSON text. Error messages never echo the payload: V8's messages can contain a fragment of the
 * body, which may be sensitive.
 */
export function parseJson(text: string): JsonResult {
  try {
    // A leading BOM is removed like `fetch().json()` does.
    return {
      ok: true,
      value: JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown,
    };
  } catch (error) {
    const position = /position (\d+)/.exec((error as Error).message)?.[1];
    return {
      ok: false,
      reason:
        position === undefined
          ? 'the body is not valid JSON'
          : `the body is not valid JSON (error at position ${position})`,
    };
  }
}
