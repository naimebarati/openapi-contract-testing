import { DEFAULT_MAX_BODY_BYTES } from '../contract/contract-options.js';
import { OpenApiAdapterError } from '../diagnostics/errors.js';
import type { HttpExchange, HttpRequestSnapshot } from '../public-types.js';

export interface AdapterRequest {
  method: string;
  url: string | URL;
}

export interface BodyLimitOptions {
  /** Same meaning (and default, 10 MiB) as `validation.maxBodyBytes`. Larger bodies are never fully buffered. */
  maxBodyBytes?: number;
}

export function bodyLimit(options: BodyLimitOptions | undefined): number {
  const max = options?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (!Number.isInteger(max) || max <= 0) {
    throw new OpenApiAdapterError('maxBodyBytes must be a positive integer.');
  }
  return max;
}

export function requestSnapshot(request: AdapterRequest, where: string): HttpRequestSnapshot {
  if (
    typeof request !== 'object' ||
    typeof request.method !== 'string' ||
    (typeof request.url !== 'string' && !(request.url instanceof URL))
  ) {
    throw new OpenApiAdapterError(
      `${where}: pass the request as { method, url } (the client response does not reliably carry it).`,
    );
  }
  return { method: request.method, url: request.url };
}

export type { HttpExchange };
