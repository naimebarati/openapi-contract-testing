import { OpenApiConfigError } from '../diagnostics/errors.js';
import type {
  LoadOpenApiContractOptions,
  UnsupportedFeaturePolicy,
  WriteOnlyInResponsePolicy,
} from '../public-types.js';

export const DEFAULT_MAX_FILES = 1000;
// Real-world documents are large (Stripe 8 MB, GitHub 14 MB as one file); the limit only guards against absurd input.
export const DEFAULT_MAX_BYTES_PER_FILE = 32 * 1024 * 1024;
export const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_ERRORS = 100;

export type ResolvedInput =
  | { kind: 'file'; path: string }
  | { kind: 'document'; document: Record<string, unknown> }
  | { kind: 'content'; content: string; contentType: 'yaml' | 'json' };

export interface ResolvedOptions {
  input: ResolvedInput;
  baseDir: string | undefined;
  refs: { rootDir: string | undefined; maxFiles: number; maxBytesPerFile: number };
  validation: {
    validateFormats: boolean;
    customFormats: Record<string, RegExp | ((value: string) => boolean)>;
    maxErrors: number;
    maxBodyBytes: number;
    unsupportedFeaturePolicy: UnsupportedFeaturePolicy;
    includeActualValues: boolean;
    writeOnlyInResponse: WriteOnlyInResponsePolicy;
  };
  routing: {
    baseUrl: string | undefined;
    basePath: string | undefined;
    trailingSlash: 'strict' | 'ignore';
    serverIndex: number | undefined;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function section(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  if (value === undefined) return {};
  if (!isRecord(value)) throw new OpenApiConfigError(`Option "${key}" must be an object.`);
  return value;
}

function assertKnownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  at: string,
): void {
  for (const key of Object.keys(obj)) {
    if (allowed.includes(key)) continue;
    if (at === 'refs' && key === 'allowRemote') {
      throw new OpenApiConfigError(
        'Option "refs.allowRemote" is not supported: remote references and URL sources are not implemented in this version.',
      );
    }
    throw new OpenApiConfigError(`Unknown option "${at === '' ? key : `${at}.${key}`}".`);
  }
}

function positiveInt(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new OpenApiConfigError(`Option "${name}" must be a positive integer.`);
  }
  return value;
}

function oneOf<T extends string>(
  value: unknown,
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new OpenApiConfigError(`Option "${name}" must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value === '') {
    throw new OpenApiConfigError(`Option "${name}" must be a non-empty string.`);
  }
  return value;
}

function optionalBoolean(value: unknown, name: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean')
    throw new OpenApiConfigError(`Option "${name}" must be a boolean.`);
  return value;
}

function resolveInput(raw: Record<string, unknown>): ResolvedInput {
  const given = ['source', 'document', 'content'].filter((k) => raw[k] !== undefined);
  if (given.length !== 1) {
    throw new OpenApiConfigError(
      `Exactly one of "source", "document" or "content" is required (received ${
        given.length === 0 ? 'none' : given.join(', ')
      }).`,
    );
  }
  if (raw['source'] !== undefined) {
    const source = raw['source'];
    if (source instanceof URL) {
      if (source.protocol !== 'file:') {
        throw new OpenApiConfigError(
          `Only local files are supported as "source" (got ${source.protocol}). Remote documents are not supported in this version.`,
        );
      }
      return { kind: 'file', path: source.pathname };
    }
    if (typeof source !== 'string' || source === '') {
      throw new OpenApiConfigError('Option "source" must be a non-empty file path or file: URL.');
    }
    if (/^[a-z][a-z0-9+.-]+:\/\//i.test(source)) {
      throw new OpenApiConfigError(
        `Option "source" looks like a URL (${source.split(':')[0] ?? ''}:). Remote documents are not supported in this version; pass a local file path.`,
      );
    }
    return { kind: 'file', path: source };
  }
  if (raw['document'] !== undefined) {
    if (!isRecord(raw['document'])) {
      throw new OpenApiConfigError('Option "document" must be an object.');
    }
    return { kind: 'document', document: raw['document'] };
  }
  if (typeof raw['content'] !== 'string') {
    throw new OpenApiConfigError('Option "content" must be a string.');
  }
  if (raw['contentType'] !== 'yaml' && raw['contentType'] !== 'json') {
    throw new OpenApiConfigError(
      'Option "contentType" ("yaml" or "json") is required with "content".',
    );
  }
  return { kind: 'content', content: raw['content'], contentType: raw['contentType'] };
}

/** Validates user options and applies defaults. Unknown options are rejected, never ignored. */
export function resolveOptions(options: LoadOpenApiContractOptions): ResolvedOptions {
  if (!isRecord(options)) throw new OpenApiConfigError('Options must be an object.');
  const raw: Record<string, unknown> = options;
  assertKnownKeys(
    raw,
    ['source', 'document', 'content', 'contentType', 'baseDir', 'refs', 'validation', 'routing'],
    '',
  );
  if (raw['contentType'] !== undefined && raw['content'] === undefined) {
    throw new OpenApiConfigError('Option "contentType" is only valid together with "content".');
  }
  const input = resolveInput(raw);

  const refs = section(raw, 'refs');
  assertKnownKeys(refs, ['rootDir', 'maxFiles', 'maxBytesPerFile'], 'refs');
  const validation = section(raw, 'validation');
  assertKnownKeys(
    validation,
    [
      'validateFormats',
      'customFormats',
      'maxErrors',
      'maxBodyBytes',
      'unsupportedFeaturePolicy',
      'includeActualValues',
      'writeOnlyInResponse',
    ],
    'validation',
  );
  const routing = section(raw, 'routing');
  assertKnownKeys(routing, ['baseUrl', 'basePath', 'trailingSlash', 'serverIndex'], 'routing');

  const customFormats = validation['customFormats'] ?? {};
  if (!isRecord(customFormats)) {
    throw new OpenApiConfigError('Option "validation.customFormats" must be an object.');
  }
  for (const [name, impl] of Object.entries(customFormats)) {
    if (typeof impl !== 'function' && !(impl instanceof RegExp)) {
      throw new OpenApiConfigError(
        `Custom format "${name}" must be a RegExp or a synchronous function returning boolean.`,
      );
    }
  }

  const serverIndex = routing['serverIndex'];
  if (
    serverIndex !== undefined &&
    (!Number.isInteger(serverIndex) || (serverIndex as number) < 0)
  ) {
    throw new OpenApiConfigError('Option "routing.serverIndex" must be a non-negative integer.');
  }

  const baseUrl = optionalString(routing['baseUrl'], 'routing.baseUrl');
  if (baseUrl !== undefined && !/^https?:\/\/[^\s]+$/i.test(baseUrl)) {
    throw new OpenApiConfigError('Option "routing.baseUrl" must be an absolute http(s) URL.');
  }
  const basePath = optionalString(routing['basePath'], 'routing.basePath');
  if (basePath !== undefined && !basePath.startsWith('/')) {
    throw new OpenApiConfigError('Option "routing.basePath" must start with "/".');
  }

  return {
    input,
    baseDir: optionalString(raw['baseDir'], 'baseDir'),
    refs: {
      rootDir: optionalString(refs['rootDir'], 'refs.rootDir'),
      maxFiles: positiveInt(refs['maxFiles'], 'refs.maxFiles', DEFAULT_MAX_FILES),
      maxBytesPerFile: positiveInt(
        refs['maxBytesPerFile'],
        'refs.maxBytesPerFile',
        DEFAULT_MAX_BYTES_PER_FILE,
      ),
    },
    validation: {
      validateFormats: optionalBoolean(
        validation['validateFormats'],
        'validation.validateFormats',
        true,
      ),
      customFormats: customFormats as ResolvedOptions['validation']['customFormats'],
      maxErrors: positiveInt(validation['maxErrors'], 'validation.maxErrors', DEFAULT_MAX_ERRORS),
      maxBodyBytes: positiveInt(
        validation['maxBodyBytes'],
        'validation.maxBodyBytes',
        DEFAULT_MAX_BODY_BYTES,
      ),
      unsupportedFeaturePolicy: oneOf(
        validation['unsupportedFeaturePolicy'],
        'validation.unsupportedFeaturePolicy',
        ['error', 'warning'],
        'error',
      ),
      includeActualValues: optionalBoolean(
        validation['includeActualValues'],
        'validation.includeActualValues',
        false,
      ),
      writeOnlyInResponse: oneOf(
        validation['writeOnlyInResponse'],
        'validation.writeOnlyInResponse',
        ['error', 'warning', 'ignore'],
        'error',
      ),
    },
    routing: {
      baseUrl,
      basePath,
      trailingSlash: oneOf(
        routing['trailingSlash'],
        'routing.trailingSlash',
        ['strict', 'ignore'],
        'strict',
      ),
      serverIndex: serverIndex as number | undefined,
    },
  };
}
