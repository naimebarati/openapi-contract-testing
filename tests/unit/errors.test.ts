import { describe, expect, it } from 'vitest';
import {
  ISSUE_CODES,
  OpenApiConfigError,
  OpenApiContractAssertionError,
  OpenApiContractError,
  OpenApiInputError,
  OpenApiSpecError,
} from '../../src/index.js';

describe('error classes', () => {
  it('share a common base and keep their own name', () => {
    const result = { valid: false, errors: [], warnings: [] };
    const errors = [
      new OpenApiSpecError('spec', []),
      new OpenApiConfigError('config'),
      new OpenApiInputError('input'),
      new OpenApiContractAssertionError('assert', result),
    ];
    for (const error of errors) {
      expect(error).toBeInstanceOf(OpenApiContractError);
      expect(error).toBeInstanceOf(Error);
    }
    expect(errors.map((e) => e.name)).toEqual([
      'OpenApiSpecError',
      'OpenApiConfigError',
      'OpenApiInputError',
      'OpenApiContractAssertionError',
    ]);
  });

  it('exposes the structured result on assertion errors', () => {
    const result = { valid: false, errors: [], warnings: [] };
    expect(new OpenApiContractAssertionError('x', result).result).toBe(result);
  });
});

describe('issue codes', () => {
  it('are unique', () => {
    expect(new Set(ISSUE_CODES).size).toBe(ISSUE_CODES.length);
  });

  it('contain every code required by the design brief', () => {
    for (const code of [
      'request.invalid_url',
      'operation.not_found',
      'operation.ambiguous',
      'response.status_not_documented',
      'response.content_type_missing',
      'response.content_type_unexpected',
      'response.body_missing',
      'response.body_unexpected',
      'response.body.invalid_json',
      'response.body.schema_invalid',
      'response.header_missing',
      'response.header_invalid',
      'response.body_validation_unsupported',
      'spec.invalid',
      'spec.unsupported_feature',
      'reference.not_allowed',
      'reference.not_found',
      'schema.compile_failed',
    ]) {
      expect(ISSUE_CODES).toContain(code);
    }
  });
});
