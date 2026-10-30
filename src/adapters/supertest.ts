import type { HttpExchange } from '../public-types.js';
import { requestSnapshot } from './shared.js';
import type { AdapterRequest } from './shared.js';

export type { AdapterRequest } from './shared.js';

/** The parts of a Supertest / Superagent response this adapter uses. */
export interface SupertestResponseLike {
  readonly status: number;
  readonly headers: Record<string, string | string[] | number | undefined>;
  readonly body?: unknown;
  /** Present for text and JSON responses; `undefined` for binary payloads. */
  readonly text?: string;
}

/**
 * Turns a Supertest response into an exchange.
 *
 * Pass the request explicitly (Supertest does not reliably expose it). Presence of a body is taken from
 * `text`, because Superagent reports `body: {}` for responses without a payload. Textual payloads are
 * handed over as raw text so the validator parses them exactly once.
 *
 * Superagent throws on JSON it cannot parse. To observe such a response as a contract violation
 * (`response.body.invalid_json`) install a text parser: `.buffer(true).parse(textParser)`; a string `body`
 * without `text` is then treated as the raw payload.
 */
export function fromSupertest(
  response: SupertestResponseLike,
  request: AdapterRequest,
): HttpExchange {
  const exchange: HttpExchange = {
    request: requestSnapshot(request, 'fromSupertest'),
    response: { status: response.status, headers: response.headers },
  };
  if (typeof response.text === 'string') {
    exchange.response.bodyPresent = response.text.length > 0;
    if (response.text.length > 0) exchange.response.rawBody = response.text;
  } else if (response.body instanceof Uint8Array) {
    exchange.response.bodyPresent = response.body.byteLength > 0;
    if (response.body.byteLength > 0) exchange.response.rawBody = response.body;
  } else if (typeof response.body === 'string') {
    // Superagent's own parsers always set `text`; a string body without it comes from a custom text parser
    // (`.buffer(true).parse(...)`), which is how invalid JSON can be observed. Treat it as the raw payload.
    exchange.response.bodyPresent = response.body.length > 0;
    if (response.body.length > 0) exchange.response.rawBody = response.body;
  } else {
    // Nothing raw is available: trust a parsed body only when it carries information.
    exchange.response.bodyPresent = response.body !== undefined && !isEmptyObject(response.body);
    if (exchange.response.bodyPresent) exchange.response.body = response.body;
  }
  return exchange;
}

function isEmptyObject(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}
