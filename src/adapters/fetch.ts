import { OpenApiAdapterError } from '../diagnostics/errors.js';
import type { HttpExchange } from '../public-types.js';
import { bodyLimit, requestSnapshot } from './shared.js';
import type { AdapterRequest, BodyLimitOptions } from './shared.js';

export type { AdapterRequest } from './shared.js';

export type { BodyLimitOptions } from './shared.js';

/** The parts of the Fetch API `Response` this adapter uses (works with Node's built-in `fetch`, undici, etc.). */
export interface FetchResponseLike {
  readonly status: number;
  readonly headers: Iterable<[string, string]>;
  readonly bodyUsed: boolean;
  clone(): FetchResponseLike;
  readonly body: ReadableStream<Uint8Array> | null;
}

/** A Fetch `Request`, or just `{ method, url }`. */
export type FetchRequestLike = AdapterRequest | { readonly method: string; readonly url: string };

/**
 * Turns a Fetch `Response` into an exchange. The body is read from `response.clone()`, so the caller can
 * still consume the original. Reading stops one byte after `maxBodyBytes`, so oversized bodies are
 * reported by the validator instead of being buffered.
 */
export async function fromFetch(
  request: FetchRequestLike,
  response: FetchResponseLike,
  options?: BodyLimitOptions,
): Promise<HttpExchange> {
  const limit = bodyLimit(options);
  const snapshot = requestSnapshot(request, 'fromFetch');

  let copy: FetchResponseLike;
  try {
    copy = response.clone();
  } catch (error) {
    throw new OpenApiAdapterError(
      `fromFetch: the response body cannot be cloned (${(error as Error).message}). Call the adapter before the body is read, or build the exchange from the text you already have.`,
    );
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  if (copy.body !== null) {
    const reader = copy.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        // Keep at most limit + 1 bytes: one byte over is enough for the validator to report the overflow.
        const keep = Math.min(value.byteLength, limit + 1 - size);
        chunks.push(keep === value.byteLength ? value : value.subarray(0, keep));
        size += keep;
        if (size > limit) {
          // Not awaited: on a cloned (tee'd) stream cancel() only settles once the original branch is
          // cancelled or read too, which the caller may do much later.
          reader.cancel().catch(() => undefined);
          break;
        }
      }
    } catch (error) {
      throw new OpenApiAdapterError(
        `fromFetch: reading the response body failed (${(error as Error).message}).`,
      );
    }
  }

  const exchange: HttpExchange = {
    request: snapshot,
    response: { status: response.status, headers: response.headers, bodyPresent: size > 0 },
  };
  if (size > 0) exchange.response.rawBody = concat(chunks, size);
  return exchange;
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  if (chunks.length === 1) return chunks[0] as Uint8Array;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
