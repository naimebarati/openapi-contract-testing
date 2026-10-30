import { parseDocument } from 'yaml';
import { OpenApiSpecError } from '../diagnostics/errors.js';
import { createIssue } from '../diagnostics/issue-factory.js';

const MAX_ALIAS_COUNT = 100;

/**
 * Parses JSON or YAML text into plain data. Failures raise `OpenApiSpecError` (`spec.invalid`) and
 * never crash the process: duplicate keys, syntax errors and alias expansion bombs are all reported.
 */
export function parseDocumentText(text: string, format: 'yaml' | 'json', label: string): unknown {
  if (format === 'json') {
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw invalid(`${label}: invalid JSON (${(error as Error).message}).`);
    }
  }
  const doc = parseDocument(text, { uniqueKeys: true });
  const first = doc.errors[0];
  if (first) {
    const position = first.linePos?.[0];
    const where = position ? ` at line ${position.line}, column ${position.col}` : '';
    throw invalid(
      `${label}: invalid YAML${where}: ${(first.message.split('\n')[0] ?? '').replace(/ at line \d+, column \d+:?$/, '')}`,
      {
        line: position?.line,
        column: position?.col,
      },
    );
  }
  try {
    return doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT }) as unknown;
  } catch (error) {
    throw invalid(`${label}: invalid YAML (${(error as Error).message}).`);
  }
}

/** Chooses the parser from the file extension, falling back to content sniffing. */
export function detectFormat(fileName: string, text: string): 'yaml' | 'json' {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  return text.trimStart().startsWith('{') ? 'json' : 'yaml';
}

function invalid(message: string, location?: { line?: number; column?: number }): OpenApiSpecError {
  const sourceLocation =
    location?.line === undefined
      ? undefined
      : {
          line: location.line,
          ...(location.column === undefined ? {} : { column: location.column }),
        };
  return new OpenApiSpecError(message, [
    createIssue('spec.invalid', message, sourceLocation ? { sourceLocation } : {}),
  ]);
}
