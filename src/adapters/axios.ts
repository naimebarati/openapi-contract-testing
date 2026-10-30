import { OpenApiAdapterError } from '../diagnostics/errors.js';
import type { HttpExchange } from '../public-types.js';
import { requestSnapshot } from './shared.js';
import type { AdapterRequest } from './shared.js';

export type { AdapterRequest } from './shared.js';

/** The parts of an `AxiosResponse` this adapter uses. */
export interface AxiosResponseLike {
  readonly status: number;
  readonly headers: unknown;
  readonly data: unknown;
  readonly config?: {
    readonly method?: string;
    readonly url?: string;
    readonly baseURL?: string;
    readonly responseType?: string;
  };
}

/**
 * Turns an Axios response into an exchange.
 *
 * Method and URL come from `response.config` (`baseURL` and `url` are combined like Axios does) unless
 * `request` overrides them. The body is interpreted according to `config.responseType`:
 *
 * - default / `'json'`: `data` is what Axios parsed. Axios hides invalid JSON by returning the text, so use
 *   `responseType: 'text'` or `'arraybuffer'` when you need exact JSON syntax checks.
 * - `'text'` / `'arraybuffer'`: the raw payload is validated and parsed by this package.
 * - `'stream'`, `'blob'`, `'document'`: rejected, as they cannot be snapshotted without consuming them.
 */
export function fromAxios(
  response: AxiosResponseLike,
  request?: Partial<AdapterRequest>,
): HttpExchange {
  const config = response.config ?? {};
  const method = request?.method ?? config.method;
  const url = request?.url ?? combineUrl(config.baseURL, config.url);
  if (method === undefined || url === undefined) {
    throw new OpenApiAdapterError(
      'fromAxios: the response has no config.method/config.url; pass { method, url } as the second argument.',
    );
  }
  const exchange: HttpExchange = {
    request: requestSnapshot({ method, url }, 'fromAxios'),
    response: { status: response.status, headers: headersOf(response.headers) },
  };

  const { data } = response;
  switch (config.responseType) {
    case 'stream':
    case 'blob':
    case 'document':
      throw new OpenApiAdapterError(
        `fromAxios: responseType "${config.responseType}" cannot be validated without consuming the body. Use "json", "text" or "arraybuffer".`,
      );
    case 'arraybuffer': {
      const bytes = toBytes(data);
      exchange.response.bodyPresent = bytes.byteLength > 0;
      if (bytes.byteLength > 0) exchange.response.rawBody = bytes;
      break;
    }
    case 'text': {
      const text = typeof data === 'string' ? data : '';
      exchange.response.bodyPresent = text.length > 0;
      if (text.length > 0) exchange.response.rawBody = text;
      break;
    }
    default: {
      // Axios uses '' (or undefined) for "no body"; everything else, including null and 0, is a parsed value.
      const present = data !== '' && data !== undefined;
      exchange.response.bodyPresent = present;
      if (present) exchange.response.body = data;
    }
  }
  return exchange;
}

function combineUrl(baseURL: string | undefined, url: string | undefined): string | undefined {
  if (url === undefined) return baseURL;
  if (baseURL === undefined || /^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url;
  return `${baseURL.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
}

function headersOf(headers: unknown): Record<string, string | string[] | number | undefined> {
  if (typeof headers !== 'object' || headers === null) return {};
  // AxiosHeaders exposes toJSON() (name -> value); plain objects are used as they are.
  const candidate = headers as { toJSON?: () => unknown };
  const plain = typeof candidate.toJSON === 'function' ? candidate.toJSON() : headers;
  return plain as Record<string, string | string[] | number | undefined>;
}

function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data === undefined || data === null || data === '') return new Uint8Array(0);
  throw new OpenApiAdapterError(
    'fromAxios: responseType "arraybuffer" returned data that is not an ArrayBuffer or Buffer.',
  );
}
