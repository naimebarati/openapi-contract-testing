import type { ContractIssue } from '../public-types.js';
import type { HeaderBag } from '../utils/headers.js';
import {
  isJsonMediaType,
  isTextMediaType,
  parseMediaType,
  selectMediaType,
} from '../utils/media-type.js';
import type { ParsedMediaType } from '../utils/media-type.js';
import { truncateValue } from '../utils/safe-values.js';
import { bodyText, parseJson } from './body-parser.js';
import type { CompiledMediaType, CompiledResponse } from './compile-contract.js';
import type { BodyInput } from './exchange.js';
import { makeIssue } from './issue-context.js';
import type { IssueContext } from './issue-context.js';
import { parseScalar } from './scalar-values.js';
import type { SchemaCompiler, SchemaViolation } from './schema-compiler.js';

export interface BodyCheck {
  response: CompiledResponse;
  headers: HeaderBag;
  body: BodyInput;
  method: string;
  status: number;
  maxBodyBytes: number;
  compiler: SchemaCompiler;
  context: IssueContext;
}

/** HTTP forbids a message body for these responses, independent of the contract. */
export function noBodyReason(method: string, status: number): string | undefined {
  if (method === 'HEAD') return 'a response to a HEAD request';
  if (status < 200) return `a ${status} informational response`;
  if (status === 204) return 'a 204 No Content response';
  if (status === 205) return 'a 205 Reset Content response';
  if (status === 304) return 'a 304 Not Modified response';
  return undefined;
}

function hasPayload(body: BodyInput): boolean {
  return body.state !== 'absent' && body.state !== 'empty';
}

export function validateBody(check: BodyCheck): ContractIssue[] {
  const { response, headers, body, method, status, context } = check;
  const noBody = noBodyReason(method, status);

  if (noBody !== undefined) {
    const issues: ContractIssue[] = [];
    if (hasPayload(body)) {
      issues.push(
        makeIssue(
          context,
          'response.body_unexpected',
          `HTTP does not allow a body in ${noBody}, but one was received.`,
        ),
      );
    }
    // A HEAD response mirrors GET headers: when a Content-Type is sent it must still fit the contract.
    const contentType = headers.first('content-type');
    if (method === 'HEAD' && response.contentDefined && contentType !== undefined) {
      const parsed = parseMediaType(contentType);
      if (!parsed || !pick(parsed, response.mediaTypes)) {
        issues.push(contentTypeMismatch(check, parsed));
      }
    }
    return issues;
  }

  if (!response.contentDefined) {
    return hasPayload(body)
      ? [
          makeIssue(
            context,
            'response.body_unexpected',
            `The contract defines no content for this response, but a body was received.`,
          ),
        ]
      : [];
  }

  const contentTypes = headers.getAll('content-type');
  if (body.state === 'absent' || body.state === 'empty') {
    // An empty text/* payload is a valid empty string; every other empty or missing body is "missing".
    const parsed =
      contentTypes?.length === 1 ? parseMediaType(contentTypes[0] as string) : undefined;
    const entry = parsed ? pick(parsed, response.mediaTypes) : undefined;
    if (body.state === 'empty' && parsed && entry && isTextMediaType(parsed)) {
      return validateText('', parsed, entry, check);
    }
    return [
      makeIssue(
        context,
        'response.body_missing',
        body.state === 'empty'
          ? 'The response body is empty, but the contract defines content.'
          : 'No response body was received, but the contract defines content.',
        { expected: { mediaTypes: response.mediaTypes.map((m) => m.key) } },
      ),
    ];
  }

  if (contentTypes === undefined) {
    return [
      makeIssue(
        context,
        'response.content_type_missing',
        'The response has a body but no Content-Type header.',
        {
          expected: { mediaTypes: response.mediaTypes.map((m) => m.key) },
        },
      ),
    ];
  }
  const parsed = contentTypes.length === 1 ? parseMediaType(contentTypes[0] as string) : undefined;
  if (!parsed) return [contentTypeMismatch(check, undefined)];
  const entry = pick(parsed, response.mediaTypes);
  if (!entry) return [contentTypeMismatch(check, parsed)];

  if (body.state === 'raw' && body.size > check.maxBodyBytes) {
    return [
      makeIssue(
        context,
        'response.body_too_large',
        `The response body is ${body.size} bytes, above the limit of ${check.maxBodyBytes} (validation.maxBodyBytes); it was not validated.`,
        {
          mediaType: parsed.essence,
        },
      ),
    ];
  }

  if (isJsonMediaType(parsed)) return validateJson(parsed, entry, check);
  if (isTextMediaType(parsed) && !isXmlLike(parsed))
    return validateText(undefined, parsed, entry, check);
  return [
    makeIssue(
      context,
      'response.body_validation_unsupported',
      `The body of type "${parsed.essence}" was received and its Content-Type matches the contract, but its content cannot be validated against a schema in this version.`,
      { severity: 'warning', mediaType: parsed.essence },
    ),
  ];
}

function isXmlLike(mediaType: ParsedMediaType): boolean {
  return mediaType.subtype === 'xml' || mediaType.suffix === 'xml' || mediaType.subtype === 'html';
}

function pick(
  actual: ParsedMediaType,
  mediaTypes: readonly CompiledMediaType[],
): CompiledMediaType | undefined {
  return selectMediaType(
    actual,
    mediaTypes.map((value) => ({ range: value.range, value })),
  )?.value;
}

function contentTypeMismatch(check: BodyCheck, actual: ParsedMediaType | undefined): ContractIssue {
  const expected = check.response.mediaTypes.map((m) => m.key);
  return makeIssue(
    check.context,
    'response.content_type_unexpected',
    actual
      ? `Content-Type "${actual.essence}" is not defined for this response. Defined: ${expected.join(', ')}.`
      : `The Content-Type header is not a valid media type (or is repeated). Defined: ${expected.join(', ')}.`,
    { expected: { mediaTypes: expected }, ...(actual ? { mediaType: actual.essence } : {}) },
  );
}

function schemaIssues(
  violations: readonly SchemaViolation[],
  mediaType: string,
  context: IssueContext,
): ContractIssue[] {
  return violations.map((v) =>
    makeIssue(context, 'response.body.schema_invalid', v.message, {
      severity: v.severity,
      instancePath: v.instancePath,
      schemaPath: v.schemaPath,
      keyword: v.keyword,
      mediaType,
      expected: v.expected,
      actual: v.actual,
    }),
  );
}

function validateJson(
  parsed: ParsedMediaType,
  entry: CompiledMediaType,
  check: BodyCheck,
): ContractIssue[] {
  const { body, context } = check;
  let value: unknown;
  if (body.state === 'parsed') {
    value = body.value; // already parsed by the HTTP client: never parsed twice
  } else if (body.state === 'raw') {
    const text = bodyText(body);
    const result = text.ok ? parseJson(text.text) : text;
    if (!result.ok) {
      return [
        makeIssue(
          context,
          'response.body.invalid_json',
          `Response body is not valid JSON: ${result.reason}.`,
          { mediaType: parsed.essence },
        ),
      ];
    }
    value = result.value;
  } else {
    return [opaqueIssue(parsed, context)];
  }
  if (entry.handle === undefined) return [];
  return schemaIssues(check.compiler.get(entry.handle).validate(value), parsed.essence, context);
}

function validateText(
  known: string | undefined,
  parsed: ParsedMediaType,
  entry: CompiledMediaType,
  check: BodyCheck,
): ContractIssue[] {
  const { body, context } = check;
  let value: unknown;
  if (known !== undefined) value = known;
  else if (body.state === 'parsed') value = body.value;
  else if (body.state === 'raw') {
    const text = bodyText(body, parsed.params['charset']);
    if (!text.ok) {
      return [
        makeIssue(
          context,
          'response.body_validation_unsupported',
          `The text body could not be read: ${text.reason}.`,
          { severity: 'warning', mediaType: parsed.essence },
        ),
      ];
    }
    value = text.text;
  } else {
    return [opaqueIssue(parsed, context)];
  }
  if (entry.handle === undefined) return [];

  // Text is validated as the scalar its schema declares (string, or a number/boolean written as text).
  const spec = entry.textSpec;
  if (spec.kind === 'array' || spec.kind === 'unsupported') {
    return [
      makeIssue(
        context,
        'response.body_validation_unsupported',
        `A text body cannot be validated against this schema${spec.kind === 'unsupported' ? `: ${spec.reason}` : ' (array)'}; only Content-Type and presence were checked.`,
        { severity: 'warning', mediaType: parsed.essence },
      ),
    ];
  }
  if (spec.kind === 'scalar' && typeof value === 'string') {
    const scalar = parseScalar(value, spec.type);
    if (!scalar.ok) {
      return [
        makeIssue(
          context,
          'response.body.schema_invalid',
          `must be ${scalar.reason} written as text`,
          {
            instancePath: '',
            mediaType: parsed.essence,
            expected: { type: spec.type },
            ...(context.includeActualValues ? { actual: truncateValue(value) } : {}),
          },
        ),
      ];
    }
    value = scalar.value;
  }
  return schemaIssues(check.compiler.get(entry.handle).validate(value), parsed.essence, context);
}

function opaqueIssue(parsed: ParsedMediaType, context: IssueContext): ContractIssue {
  return makeIssue(
    context,
    'response.body_validation_unsupported',
    'The exchange says a body is present (bodyPresent: true) but provides neither "body" nor "rawBody"; its content was not validated.',
    { severity: 'warning', mediaType: parsed.essence },
  );
}
