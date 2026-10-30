import type { HttpExchange } from '../public-types.js';
import { requestSnapshot } from './shared.js';
import type { AdapterRequest } from './shared.js';

export type { AdapterRequest } from './shared.js';

/** The parts of a `light-my-request` response (Fastify's `app.inject()`) this adapter uses. */
export interface FastifyInjectResponseLike {
  readonly statusCode: number;
  readonly headers: Record<string, string | string[] | number | undefined>;
  /** Raw bytes; preferred. */
  readonly rawPayload?: Uint8Array;
  /** The same payload decoded as text. */
  readonly payload?: string;
}

/**
 * Turns a Fastify `inject()` response into an exchange. The payload is passed on raw, so it is parsed
 * exactly once, by the validator. Pass the request you injected.
 */
export function fromFastifyInject(
  response: FastifyInjectResponseLike,
  request: AdapterRequest,
): HttpExchange {
  const exchange: HttpExchange = {
    request: requestSnapshot(request, 'fromFastifyInject'),
    response: { status: response.statusCode, headers: response.headers },
  };
  const raw = response.rawPayload ?? response.payload;
  const size = typeof raw === 'string' ? raw.length : (raw?.byteLength ?? 0);
  exchange.response.bodyPresent = size > 0;
  if (raw !== undefined && size > 0) exchange.response.rawBody = raw;
  return exchange;
}
