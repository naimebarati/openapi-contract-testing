export type ExtractedPath = { ok: true; path: string } | { ok: false; reason: string };

const VIRTUAL_ORIGIN = 'http://openapi-contract-testing.invalid';

/**
 * Extracts the path (query and fragment removed, percent-encoding kept) used to look up an operation.
 *
 * - Absolute http(s) URLs: their pathname; the host is not compared (tests run against localhost).
 * - Paths starting with a single `/`: used as is; `baseUrl` (when given) contributes its path as a prefix.
 * - Anything else is rejected rather than guessed.
 */
export function extractRequestPath(url: string | URL, baseUrl?: string): ExtractedPath {
  try {
    if (url instanceof URL) return checkProtocol(url);
    if (url.startsWith('/') && !url.startsWith('//')) {
      const { pathname } = new URL(`${VIRTUAL_ORIGIN}${url}`);
      const prefix = baseUrl === undefined ? '' : new URL(baseUrl).pathname.replace(/\/+$/, '');
      return { ok: true, path: `${prefix}${pathname}` };
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return checkProtocol(new URL(url));
  } catch {
    return { ok: false, reason: 'the URL could not be parsed' };
  }
  return {
    ok: false,
    reason: 'the URL must be absolute (http/https) or a path starting with a single "/"',
  };
}

function checkProtocol(url: URL): ExtractedPath {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `unsupported URL scheme "${url.protocol}"` };
  }
  return { ok: true, path: url.pathname };
}
