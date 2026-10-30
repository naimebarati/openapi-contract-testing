import type { ContractIssue } from '../public-types.js';
import { isSensitiveHeader } from '../utils/headers.js';
import type { HeaderBag } from '../utils/headers.js';
import { truncateValue } from '../utils/safe-values.js';
import type { CompiledHeader } from './compile-contract.js';
import { makeIssue } from './issue-context.js';
import type { IssueContext } from './issue-context.js';
import { parseScalar } from './scalar-values.js';
import type { ScalarType } from './scalar-values.js';
import type { SchemaCompiler } from './schema-compiler.js';

/** Checks the response headers declared by the contract. Undeclared headers are never failures. */
export function validateHeaders(
  declared: readonly CompiledHeader[],
  headers: HeaderBag,
  context: IssueContext,
  compiler: SchemaCompiler,
): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const seen = new Set<string>();
  for (const header of declared) {
    const lower = header.name.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);

    const values = headers.getAll(header.name);
    if (values === undefined) {
      if (header.required) {
        issues.push(
          makeIssue(
            context,
            'response.header_missing',
            `Required response header "${header.name}" is missing.`,
            {
              header: header.name,
            },
          ),
        );
      }
      continue;
    }
    if (
      header.handle === undefined ||
      header.spec.kind === 'any' ||
      header.spec.kind === 'unsupported'
    )
      continue;

    const schema = compiler.get(header.handle);
    const shown = (value: unknown): unknown => {
      if (!context.includeActualValues) return undefined;
      return isSensitiveHeader(header.name) ? '[redacted]' : truncateValue(value);
    };
    const invalid = (message: string, extras: Partial<ContractIssue> = {}): void => {
      issues.push(
        makeIssue(context, 'response.header_invalid', message, { header: header.name, ...extras }),
      );
    };

    if (header.spec.kind === 'scalar') {
      // Repeated header lines are one comma-joined value (RFC 9110), except Set-Cookie which never is.
      const candidates =
        lower === 'set-cookie' || values.length === 1 ? values : [values.join(', ')];
      for (const text of candidates) {
        const parsed = parseScalar(text, header.spec.type);
        if (!parsed.ok) {
          invalid(`Response header "${header.name}" must be ${parsed.reason}.`, {
            expected: { type: header.spec.type },
            actual: shown(text),
          });
          continue;
        }
        for (const violation of schema.validate(parsed.value)) {
          invalid(`Response header "${header.name}" ${violation.message}.`, {
            severity: violation.severity,
            schemaPath: violation.schemaPath,
            keyword: violation.keyword,
            ...(violation.expected ? { expected: violation.expected } : {}),
            actual: shown(text),
          });
        }
      }
      continue;
    }

    const items: (string | number | boolean)[] = [];
    let ok = true;
    for (const line of values) {
      const parts = line.trim() === '' ? [] : line.split(',').map((part) => part.trim());
      for (const part of parts) {
        const parsed = parseScalar(part, header.spec.item satisfies ScalarType);
        if (!parsed.ok) {
          ok = false;
          invalid(
            `Response header "${header.name}" item ${items.length} must be ${parsed.reason}.`,
            {
              instancePath: `/${items.length}`,
              expected: { type: header.spec.item },
              actual: shown(part),
            },
          );
          break;
        }
        items.push(parsed.value);
      }
    }
    if (!ok) continue;
    for (const violation of schema.validate(items)) {
      invalid(`Response header "${header.name}" ${violation.message}.`, {
        severity: violation.severity,
        instancePath: violation.instancePath,
        schemaPath: violation.schemaPath,
        keyword: violation.keyword,
        ...(violation.expected ? { expected: violation.expected } : {}),
        actual: shown(values.length === 1 ? values[0] : values),
      });
    }
  }
  return issues;
}
