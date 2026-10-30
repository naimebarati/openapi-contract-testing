import { STATUS_CODES } from 'node:http';
import type { ContractIssue, ContractValidationResult } from '../public-types.js';

export interface FormatOptions {
  /** `'text'` (default) is meant for humans, `'json'` for tools. */
  format?: 'text' | 'json';
}

/** `/data/items/0/e-mail` -> `$.data.items[0]['e-mail']` */
export function toJsonPath(pointer: string): string {
  if (pointer === '') return '$';
  return pointer
    .slice(1)
    .split('/')
    .reduce((path, raw) => {
      const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      if (/^\d+$/.test(key)) return `${path}[${key}]`;
      return /^[A-Za-z_$][\w$]*$/.test(key)
        ? `${path}.${key}`
        : `${path}['${key.replace(/'/g, "\\'")}']`;
    }, '$');
}

/**
 * Renders a validation result. Formatting lives outside the validator: it only reads the structured
 * result, so it cannot influence whether a response is valid.
 */
export function formatValidationResult(
  result: ContractValidationResult,
  options: FormatOptions = {},
): string {
  if (options.format === 'json') return JSON.stringify(withoutTiming(result), null, 2);

  const issues = [...result.errors, ...result.warnings];
  const first = issues[0];
  const lines: string[] = [
    result.valid
      ? 'OpenAPI response contract passed with warnings'
      : 'OpenAPI response contract failed',
    '',
  ];

  if (first) {
    const location = `${first.method ?? ''} ${first.actualPath ?? ''}`.trim();
    const operation = result.operation
      ? ` (operation: ${result.operation.method} ${result.operation.path}${
          result.operation.operationId ? `, operationId: ${result.operation.operationId}` : ''
        })`
      : '';
    lines.push(`${location}${operation}`);
    if (first.status !== undefined) {
      lines.push(
        `Actual response: ${first.status}${STATUS_CODES[first.status] ? ` ${STATUS_CODES[first.status] ?? ''}` : ''}`,
      );
    }
    lines.push('');
  }

  let number = 1;
  for (const issue of result.errors) lines.push(...formatIssue(issue, number++));
  if (result.warnings.length > 0) {
    lines.push('Warnings:', '');
    for (const issue of result.warnings) lines.push(...formatIssue(issue, number++));
  }
  return lines.join('\n').trimEnd();
}

function formatIssue(issue: ContractIssue, number: number): string[] {
  const lines = [`${number}. ${issue.code}`];
  if (issue.instancePath !== undefined && issue.code.startsWith('response.body')) {
    lines.push(`   Path: ${toJsonPath(issue.instancePath)}`);
  }
  if (issue.header !== undefined) lines.push(`   Header: ${issue.header}`);
  if (issue.mediaType !== undefined) lines.push(`   Media type: ${issue.mediaType}`);
  lines.push(`   Message: ${issue.message}`);
  if (issue.expected !== undefined) lines.push(`   Expected: ${compact(issue.expected)}`);
  if ('actual' in issue) lines.push(`   Actual: ${compact(issue.actual)}`);
  if (issue.schemaPath !== undefined) lines.push(`   Contract: ${issue.schemaPath}`);
  lines.push('');
  return lines;
}

function compact(value: unknown): string {
  const text = value === undefined ? 'undefined' : JSON.stringify(value);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function withoutTiming(
  result: ContractValidationResult,
): Omit<ContractValidationResult, 'durationMs'> {
  return {
    valid: result.valid,
    ...(result.operation ? { operation: result.operation } : {}),
    errors: result.errors,
    warnings: result.warnings,
  };
}
