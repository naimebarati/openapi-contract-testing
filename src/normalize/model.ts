import type { DocLocation } from '../loader/reference-resolver.js';
import type { OasVersion } from '../loader/spec-validator.js';

/** A Schema Object (or Reference Object to one) together with the document it lives in. */
export interface SchemaSource {
  node: unknown;
  loc: DocLocation;
}

export interface NormalizedHeader {
  /** Name as written in the contract. */
  name: string;
  required: boolean;
  schema: SchemaSource | undefined;
  loc: DocLocation;
}

export interface NormalizedMediaType {
  /** Media type key exactly as written, e.g. `application/json` or `application/*`. */
  key: string;
  schema: SchemaSource | undefined;
  loc: DocLocation;
}

export interface NormalizedResponse {
  /** `200`, `2XX` or `default`. */
  key: string;
  headers: readonly NormalizedHeader[];
  content: readonly NormalizedMediaType[];
  loc: DocLocation;
}

export interface NormalizedResponses {
  exact: ReadonlyMap<number, NormalizedResponse>;
  /** Keyed by the first digit, `2` for `2XX`. */
  ranges: ReadonlyMap<number, NormalizedResponse>;
  default: NormalizedResponse | undefined;
  keys: readonly string[];
}

export interface NormalizedOperation {
  /** Upper-case HTTP method. */
  method: string;
  /** Path template as written in the contract. */
  path: string;
  operationId: string | undefined;
  /** Path prefixes (from `servers`) under which this operation is reachable; `''` = no prefix. */
  prefixes: readonly string[];
  responses: NormalizedResponses;
  loc: DocLocation;
}

export interface NormalizedDocument {
  version: OasVersion;
  operations: readonly NormalizedOperation[];
}
