import type { ErrorObject } from 'ajv';
import { getByPointer, jsonTypeOf, truncateValue } from '../utils/safe-values.js';
import { WRITE_ONLY_KEYWORD } from './dialects/schema-dialect-adapter.js';

export interface SchemaViolation {
  /** JSON Pointer into the validated value. */
  instancePath: string;
  /** Location in the contract document (`file#/pointer` for external files). */
  schemaPath: string;
  keyword: string;
  message: string;
  expected: Record<string, unknown> | undefined;
  /** JSON type of the offending value, when it exists. */
  actualType: string | undefined;
  /** Only populated when actual values were requested. */
  actual: unknown;
  severity: 'error' | 'warning';
}

export interface ViolationContext {
  /** Contract location of a transformed schema node (Ajv's `parentSchema`), if it is known. */
  originOf: (schema: unknown) => { path: string; synthetic: boolean } | undefined;
  /** Fallback when the node is unknown: maps an Ajv schema path to a contract location. */
  mapSchemaPath: (ajvSchemaPath: string) => string;
  includeActualValues: boolean;
  writeOnlySeverity: 'error' | 'warning';
}

const LIMIT_KEYWORDS = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minProperties',
  'maxProperties',
  'multipleOf',
]);

export function toViolations(
  errors: readonly ErrorObject[],
  data: unknown,
  context: ViolationContext,
): SchemaViolation[] {
  const violations: SchemaViolation[] = [];
  for (const error of errors) {
    // `if` errors only repeat that a discriminator branch failed; the branch's own errors are reported.
    if (error.keyword === 'if') continue;
    violations.push(toViolation(error, data, context));
  }
  return violations;
}

function locate(error: ErrorObject, context: ViolationContext): string {
  const origin = context.originOf(error.parentSchema);
  if (origin === undefined) return context.mapSchemaPath(error.schemaPath);
  return origin.synthetic ? origin.path : `${origin.path}/${error.keyword}`;
}

function toViolation(
  error: ErrorObject,
  data: unknown,
  context: ViolationContext,
): SchemaViolation {
  const params = error.params as Record<string, unknown>;
  const base = {
    instancePath: error.instancePath,
    schemaPath: locate(error, context),
    keyword: error.keyword,
  };
  const value = getByPointer(data, error.instancePath);
  const exists = error.instancePath === '' || value !== undefined;
  const actualType = exists ? jsonTypeOf(value) : undefined;
  const withActual = (actual: unknown) =>
    context.includeActualValues ? truncateValue(actual) : undefined;

  if (error.keyword === WRITE_ONLY_KEYWORD) {
    return {
      ...base,
      keyword: 'writeOnly',
      message: 'property is writeOnly and must not appear in a response',
      expected: undefined,
      actualType,
      actual: withActual(value),
      severity: context.writeOnlySeverity,
    };
  }

  let message = error.message ?? 'is invalid';
  let expected: Record<string, unknown> | undefined;
  let actual: unknown = withActual(value);
  switch (error.keyword) {
    case 'type': {
      const type = Array.isArray(params['type'])
        ? (params['type'] as unknown[]).join(' | ')
        : String(params['type']);
      message = `must be ${type}${actualType === undefined ? '' : ` (received ${actualType})`}`;
      expected = { type: params['type'] };
      break;
    }
    case 'required':
      message = `must have required property '${String(params['missingProperty'])}'`;
      expected = { requiredProperty: params['missingProperty'] };
      actual = undefined;
      break;
    case 'additionalProperties':
    case 'unevaluatedProperties': {
      const name = String(params['additionalProperty'] ?? params['unevaluatedProperty']);
      message = `must NOT have additional property '${name}'`;
      expected = { additionalProperties: false };
      actual = context.includeActualValues ? name : undefined;
      break;
    }
    case 'enum': {
      const allowed = (params['allowedValues'] as unknown[] | undefined) ?? [];
      message = `must be one of: ${allowed
        .slice(0, 10)
        .map((v) => JSON.stringify(v))
        .join(', ')}${allowed.length > 10 ? ', …' : ''}`;
      expected = { allowedValues: allowed };
      break;
    }
    case 'const':
      message = `must be equal to ${JSON.stringify(params['allowedValue'])}`;
      expected = { allowedValue: params['allowedValue'] };
      break;
    case 'format':
      message = `must match format "${String(params['format'])}"`;
      expected = { type: 'string', format: params['format'] };
      break;
    case 'pattern':
      expected = { pattern: params['pattern'] };
      break;
    case 'oneOf':
      message =
        Array.isArray(params['passingSchemas']) && params['passingSchemas'].length > 1
          ? 'must match exactly one schema in oneOf, but matches several'
          : 'must match exactly one schema in oneOf, but matches none';
      break;
    default:
      if (LIMIT_KEYWORDS.has(error.keyword))
        expected = { limit: params['limit'] ?? params['multipleOf'] };
  }

  return { ...base, message, expected, actualType, actual, severity: 'error' };
}
