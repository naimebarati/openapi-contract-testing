import { OpenApiInputError } from '../diagnostics/errors.js';
import type { HttpExchange } from '../public-types.js';
import { toHeaderBag } from '../utils/headers.js';
import type { HeaderBag } from '../utils/headers.js';

const METHOD_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** How the response body arrived: never conflates "nothing", "zero bytes" and a JSON `null`. */
export type BodyInput =
  | { state: 'absent' }
  /** Zero bytes / empty string. */
  | { state: 'empty' }
  | { state: 'raw'; text: string | undefined; bytes: Uint8Array | undefined; size: number }
  /** An already parsed value (object, array, number, string, boolean, `null`). */
  | { state: 'parsed'; value: unknown }
  /** `bodyPresent: true` without any content to inspect. */
  | { state: 'opaque' };

export interface PreparedExchange {
  method: string;
  url: string | URL;
  status: number;
  responseHeaders: HeaderBag;
  body: BodyInput;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Validates the shape of an exchange (programming errors throw) and normalizes it without mutating it. */
export function prepareExchange(exchange: HttpExchange): PreparedExchange {
  if (!isRecord(exchange) || !isRecord(exchange.request) || !isRecord(exchange.response)) {
    throw new OpenApiInputError(
      'Exchange must be an object with "request" and "response" objects.',
    );
  }
  const { request, response } = exchange;
  if (typeof request.method !== 'string' || !METHOD_TOKEN.test(request.method)) {
    throw new OpenApiInputError('request.method must be a valid HTTP method token such as "GET".');
  }
  if (typeof request.url !== 'string' && !(request.url instanceof URL)) {
    throw new OpenApiInputError('request.url must be a string or a URL.');
  }
  if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
    throw new OpenApiInputError('response.status must be an integer between 100 and 599.');
  }
  if (response.bodyPresent !== undefined && typeof response.bodyPresent !== 'boolean') {
    throw new OpenApiInputError('response.bodyPresent must be a boolean.');
  }
  if (response.rawBody !== undefined && response.body !== undefined) {
    throw new OpenApiInputError(
      'Provide either response.body (already parsed) or response.rawBody (unparsed), not both: they could contradict each other.',
    );
  }
  if (
    response.rawBody !== undefined &&
    typeof response.rawBody !== 'string' &&
    !(response.rawBody instanceof Uint8Array)
  ) {
    throw new OpenApiInputError('response.rawBody must be a string or a Uint8Array.');
  }
  // Request headers are validated for shape now so request validation can use them later.
  toHeaderBag(request.headers, 'request');

  return {
    method: request.method.toUpperCase(),
    url: request.url,
    status: response.status,
    responseHeaders: toHeaderBag(response.headers, 'response'),
    body: bodyInput(response),
  };
}

function bodyInput(response: HttpExchange['response']): BodyInput {
  // `bodyPresent: false` wins: Supertest, for example, reports `body: {}` for responses without a payload.
  if (response.bodyPresent === false) return { state: 'absent' };
  const { rawBody, body } = response;
  if (rawBody !== undefined) {
    if (typeof rawBody === 'string') {
      return rawBody === ''
        ? { state: 'empty' }
        : {
            state: 'raw',
            text: rawBody,
            bytes: undefined,
            size: Buffer.byteLength(rawBody, 'utf8'),
          };
    }
    return rawBody.byteLength === 0
      ? { state: 'empty' }
      : { state: 'raw', text: undefined, bytes: rawBody, size: rawBody.byteLength };
  }
  if (body !== undefined) {
    // An empty string is an empty payload; a JSON string value must be passed as rawBody '"..."' or non-empty.
    return body === '' ? { state: 'empty' } : { state: 'parsed', value: body };
  }
  return response.bodyPresent === true ? { state: 'opaque' } : { state: 'absent' };
}
