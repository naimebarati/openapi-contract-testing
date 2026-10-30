/** Stable, machine-readable issue codes. Messages may change between releases; codes may not. */
export const ISSUE_CODES = [
  'request.invalid_url',
  'operation.not_found',
  'operation.ambiguous',
  'response.status_not_documented',
  'response.content_type_missing',
  'response.content_type_unexpected',
  'response.body_missing',
  'response.body_unexpected',
  'response.body_too_large',
  'response.body.invalid_json',
  'response.body.schema_invalid',
  'response.body_validation_unsupported',
  'response.header_missing',
  'response.header_invalid',
  'response.header_validation_unsupported',
  'spec.invalid',
  'spec.unsupported_feature',
  'spec.path_collision',
  'reference.not_allowed',
  'reference.not_found',
  'schema.compile_failed',
] as const;

export type IssueCode = (typeof ISSUE_CODES)[number];
