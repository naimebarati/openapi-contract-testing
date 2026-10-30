import type { ErrorObject, ValidateFunction } from 'ajv';
import { Ajv04, Ajv2020, addFormats } from '../utils/ajv-modules.js';
import { OpenApiSpecError } from '../diagnostics/errors.js';
import { createIssue } from '../diagnostics/issue-factory.js';
import { getByPointer } from '../utils/safe-values.js';
import type { ContractIssue } from '../public-types.js';
import oas30 from './schemas/oas-3.0.schema.json' with { type: 'json' };
import oas31 from './schemas/oas-3.1.schema.json' with { type: 'json' };
import oas32 from './schemas/oas-3.2.schema.json' with { type: 'json' };

export type OasVersion = '3.0' | '3.1' | '3.2';

const OPENAPI_PATTERN = /^3\.([012])\.\d+(?:-.+)?$/;

/** Reads the `openapi` field. Swagger 2.0 and unknown versions are rejected with a specific message. */
export function detectVersion(doc: Record<string, unknown>): {
  version: OasVersion;
  openapi: string;
} {
  if (typeof doc['swagger'] === 'string') {
    throw specInvalid(
      `Swagger/OpenAPI 2.0 documents are not supported (found swagger: "${doc['swagger']}"). Convert the document to OpenAPI 3.x.`,
    );
  }
  const openapi = doc['openapi'];
  if (typeof openapi !== 'string') {
    throw specInvalid(
      'The document has no "openapi" version string, so it is not an OpenAPI 3.x document.',
    );
  }
  const match = OPENAPI_PATTERN.exec(openapi);
  if (!match) {
    throw specInvalid(
      `Unsupported OpenAPI version "${openapi}". Supported versions: 3.0.x, 3.1.x and 3.2.x.`,
    );
  }
  return { version: `3.${match[1]}` as OasVersion, openapi };
}

const validators = new Map<OasVersion, ValidateFunction>();

function getValidator(version: OasVersion): ValidateFunction {
  const cached = validators.get(version);
  if (cached) return cached;
  // strict:false is required by the official meta-level schemas (they use annotation-only keywords).
  const options = { strict: false, allErrors: true } as const;
  let validate: ValidateFunction;
  if (version === '3.0') {
    const ajv = new Ajv04(options);
    addFormats(ajv);
    validate = ajv.compile(oas30);
  } else {
    const ajv = new Ajv2020(options);
    addFormats(ajv);
    ajv.addFormat('media-range', true);
    validate = ajv.compile(version === '3.1' ? oas31 : oas32);
  }
  validators.set(version, validate);
  return validate;
}

/**
 * Validates the document structure against the official OpenAPI JSON Schema for its version.
 * Schema Object contents are intentionally not covered here; they are checked when compiled.
 */
export function validateDocumentStructure(
  doc: Record<string, unknown>,
  version: OasVersion,
  maxErrors: number,
): ContractIssue[] {
  const validate = getValidator(version);
  if (validate(doc)) return [];
  const errors = simplify(validate.errors ?? []);

  // Split documents often write `get: { $ref: 'ops/get-user.yaml' }` or `headers: { $ref: '...' }`. OpenAPI only
  // allows a reference where a Reference Object is a permitted alternative, and the generic schema errors for a
  // misplaced one are confusing: say what is wrong.
  const misplaced = new Set<string>();
  for (const error of errors) {
    const path = error.instancePath.endsWith('/$ref')
      ? error.instancePath.slice(0, -'/$ref'.length)
      : error.instancePath;
    const value = getByPointer(doc, path);
    if (
      path !== '' &&
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      typeof (value as { $ref?: unknown }).$ref === 'string'
    ) {
      misplaced.add(path);
    }
  }
  const covered = (path: string): boolean =>
    [...misplaced].some((p) => path === p || path.startsWith(`${p}/`));
  const hints = [...misplaced]
    .sort()
    .map((path) =>
      createIssue(
        'spec.invalid',
        `${path}: a $ref is not allowed at this position (OpenAPI allows references only where a Reference Object is a permitted alternative, for example path items, parameters, responses, headers and schemas, but not in place of an Operation Object or a whole map such as "headers"). Bundle the document first, for example with \`redocly bundle\`.`,
        { instancePath: path, keyword: '$ref' },
      ),
    );
  return [
    ...hints,
    ...errors
      .filter((error) => !covered(error.instancePath))
      .map((error) =>
        createIssue(
          'spec.invalid',
          `${error.instancePath === '' ? '/' : error.instancePath}: ${error.message ?? 'is invalid'}`,
          {
            instancePath: error.instancePath,
            schemaPath: error.schemaPath,
            keyword: error.keyword,
          },
        ),
      ),
  ].slice(0, maxErrors);
}

/**
 * The official schemas express "Reference Object or X" with oneOf/anyOf, so a single mistake produces
 * several unrelated alternatives. Keep the most specific errors and drop alternative-selection noise.
 */
function simplify(errors: ErrorObject[]): ErrorObject[] {
  const meaningful = errors.filter(
    (e) =>
      e.keyword !== 'oneOf' &&
      e.keyword !== 'anyOf' &&
      e.keyword !== 'if' &&
      !(
        e.keyword === 'required' &&
        (e.params as { missingProperty?: string }).missingProperty === '$ref'
      ),
  );
  const chosen = meaningful.length > 0 ? meaningful : errors;
  const seen = new Set<string>();
  return chosen
    .filter((e) => {
      const key = `${e.instancePath}|${e.message ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) =>
      a.instancePath === b.instancePath
        ? (a.message ?? '').localeCompare(b.message ?? '')
        : a.instancePath.localeCompare(b.instancePath),
    );
}

function specInvalid(message: string): OpenApiSpecError {
  return new OpenApiSpecError(message, [createIssue('spec.invalid', message)]);
}
