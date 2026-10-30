import type { IssueCode } from './diagnostics/issue-codes.js';
import type { OpenApiContractAssertionError } from './diagnostics/errors.js';

/** Header collection in any of the shapes produced by common Node.js HTTP clients. */
export type HeadersLike =
  Headers | Record<string, string | string[] | number | undefined> | Iterable<[string, string]>;

export interface HttpRequestSnapshot {
  method: string;
  /** Absolute URL or path. Query string and fragment are ignored for operation matching. */
  url: string | URL;
  headers?: HeadersLike;
}

export interface HttpResponseSnapshot {
  status: number;
  headers?: HeadersLike;
  /**
   * Already-parsed body. `null` means a JSON `null` body, `undefined` means "not provided".
   * Never combined with `rawBody`.
   */
  body?: unknown;
  /** Tells an absent body apart from an empty one or JSON `null`. */
  bodyPresent?: boolean;
  /** Unparsed payload; parsed according to Content-Type. Mutually exclusive with `body`. */
  rawBody?: string | Uint8Array;
}

export interface HttpExchange {
  request: HttpRequestSnapshot;
  response: HttpResponseSnapshot;
}

export interface ContractIssue {
  code: IssueCode;
  severity: 'error' | 'warning';
  message: string;
  operationId?: string;
  method?: string;
  pathTemplate?: string;
  actualPath?: string;
  status?: number;
  /** Response header name for `response.header_*` issues. */
  header?: string;
  /** Media type involved in the issue, when relevant. */
  mediaType?: string;
  /** JSON Pointer to the failing part of the response body. */
  instancePath?: string;
  /** JSON Pointer to the failing keyword in the contract document. */
  schemaPath?: string;
  /** Validation keyword that failed (for example `required`, `format`). */
  keyword?: string;
  expected?: unknown;
  /** Only present when `validation.includeActualValues` is enabled. */
  actual?: unknown;
  sourceLocation?: { file?: string; line?: number; column?: number };
}

export interface OperationSummary {
  method: string;
  /** Path template as written in the contract, e.g. `/users/{id}`. */
  path: string;
  operationId?: string;
  /** Documented response keys, e.g. `['200', '4XX', 'default']`. */
  responses: string[];
}

export interface ContractValidationResult {
  valid: boolean;
  operation?: { method: string; path: string; operationId?: string };
  errors: ContractIssue[];
  warnings: ContractIssue[];
  durationMs?: number;
}

export type UnsupportedFeaturePolicy = 'error' | 'warning';
export type WriteOnlyInResponsePolicy = 'error' | 'warning' | 'ignore';

export interface LoadOpenApiContractOptions {
  /** Local file path or `file:` URL. Exactly one of `source`, `document`, `content` is required. */
  source?: string | URL;
  /** An already parsed OpenAPI document. It is never mutated. */
  document?: Record<string, unknown>;
  /** Raw YAML or JSON text. Requires `contentType`. */
  content?: string;
  contentType?: 'yaml' | 'json';
  /** Directory used to resolve relative file references for `document` and `content` inputs. */
  baseDir?: string;
  refs?: {
    /** Files outside this directory are refused. Defaults to the directory of `source`. */
    rootDir?: string;
    /** Default 50. */
    maxFiles?: number;
    /** Default 5 MiB. */
    maxBytesPerFile?: number;
  };
  validation?: {
    /** Default true. */
    validateFormats?: boolean;
    /** Synchronous custom formats, merged with the standard `ajv-formats` set. */
    customFormats?: Record<string, RegExp | ((value: string) => boolean)>;
    /** Default 100. */
    maxErrors?: number;
    /** Default 10 MiB. Larger bodies produce `response.body_too_large`. */
    maxBodyBytes?: number;
    /** What to do with contract features this package cannot validate. Default `'error'`. */
    unsupportedFeaturePolicy?: UnsupportedFeaturePolicy;
    /** Include received values in diagnostics. Default false (values are redacted). */
    includeActualValues?: boolean;
    /** Default `'error'`. */
    writeOnlyInResponse?: WriteOnlyInResponsePolicy;
  };
  routing?: {
    /** Absolute URL; its path is treated as a base path for relative request URLs. */
    baseUrl?: string;
    /** Explicit base path to strip before matching. Nothing is guessed when omitted. */
    basePath?: string;
    /** Default `'strict'`. */
    trailingSlash?: 'strict' | 'ignore';
    /** Select one entry of `servers` instead of accepting all of them. */
    serverIndex?: number;
  };
}

export interface OpenApiContract {
  /** Never throws for contract violations; returns them in the result. */
  validateResponse(exchange: HttpExchange): ContractValidationResult;
  /** Throws `OpenApiContractAssertionError` when the response does not match the contract. */
  assertResponse(exchange: HttpExchange): void;
  createAssertionError(result: ContractValidationResult): OpenApiContractAssertionError;
  getOperations(): readonly OperationSummary[];
  /** Load-time warnings, e.g. unsupported features accepted under policy `'warning'`. */
  getWarnings(): readonly ContractIssue[];
}
