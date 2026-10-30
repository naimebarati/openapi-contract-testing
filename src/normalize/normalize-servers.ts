import { OpenApiSpecError } from '../diagnostics/errors.js';
import { createIssue } from '../diagnostics/issue-factory.js';
import type { LoadDiagnostics } from '../diagnostics/load-diagnostics.js';

const MAX_PREFIX_COMBINATIONS = 64;
const AUTHORITY = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i;

/**
 * Turns an OpenAPI `servers` array into the set of path prefixes a request may use.
 * Host names are deliberately ignored (tests usually run against localhost). Variables inside the
 * path expand to their `enum` values, or to their `default`; nothing else is guessed.
 */
export function serverPrefixes(
  servers: unknown,
  where: string,
  diagnostics: LoadDiagnostics,
): string[] {
  const list =
    Array.isArray(servers) && servers.length > 0 ? (servers as unknown[]) : [{ url: '/' }];
  const prefixes = new Set<string>();
  list.forEach((server, index) => {
    const location = `${where}/${index}`;
    const record = (typeof server === 'object' && server !== null ? server : {}) as Record<
      string,
      unknown
    >;
    const url = typeof record['url'] === 'string' ? record['url'] : '/';
    const variables = (record['variables'] ?? {}) as Record<string, Record<string, unknown>>;
    const pathPart = url.replace(AUTHORITY, '').split(/[?#]/, 1)[0] ?? '';

    let candidates = [pathPart];
    for (const name of new Set([...pathPart.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1] ?? ''))) {
      const variable = variables[name];
      if (!variable || typeof variable['default'] !== 'string') {
        throw invalid(
          `Server variable "{${name}}" in ${location} has no definition with a default value.`,
          location,
        );
      }
      const values =
        Array.isArray(variable['enum']) && variable['enum'].length > 0
          ? (variable['enum'] as unknown[]).filter((v): v is string => typeof v === 'string')
          : [variable['default']];
      const expanded = candidates.flatMap((c) => values.map((v) => c.split(`{${name}}`).join(v)));
      if (expanded.length > MAX_PREFIX_COMBINATIONS) {
        diagnostics.reportUnsupported(
          `Server ${location} expands to more than ${MAX_PREFIX_COMBINATIONS} path prefixes; only default variable values are used.`,
          { schemaPath: location },
        );
        candidates = candidates.map((c) =>
          c.split(`{${name}}`).join(variable['default'] as string),
        );
      } else {
        candidates = expanded;
      }
    }
    for (const candidate of candidates) prefixes.add(normalizePrefix(candidate));
  });
  return [...prefixes].sort();
}

/** `''` for the root, otherwise a leading slash and no trailing slash. */
export function normalizePrefix(raw: string): string {
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const trimmed = withSlash.replace(/\/+$/, '');
  return trimmed;
}

function invalid(message: string, location: string): OpenApiSpecError {
  return new OpenApiSpecError(message, [
    createIssue('spec.invalid', message, { schemaPath: location }),
  ]);
}
