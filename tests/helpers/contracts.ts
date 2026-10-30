import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOptions } from '../../src/contract/contract-options.js';
import type { LoadOpenApiContractOptions } from '../../src/index.js';
import { loadDocument } from '../../src/loader/load-document.js';
import type { NormalizedDocument } from '../../src/normalize/model.js';
import { normalizeDocument } from '../../src/normalize/normalize-document.js';
import { OperationIndex } from '../../src/routing/operation-index.js';
import type { LoadDiagnostics } from '../../src/diagnostics/load-diagnostics.js';

export const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');

export function fixture(...parts: string[]): string {
  return path.join(fixturesDir, ...parts);
}

type Doc = Record<string, unknown>;

/** Wraps `paths` (and anything else) into a minimal valid OpenAPI 3.1 document. */
export function oas(paths: Doc, extra: Doc = {}, openapi = '3.1.0'): Doc {
  return { openapi, info: { title: 't', version: '1' }, paths, ...extra };
}

export const ok = { responses: { '200': { description: 'ok' } } };

export async function normalized(
  options: LoadOpenApiContractOptions,
): Promise<{ model: NormalizedDocument; diagnostics: LoadDiagnostics; index: OperationIndex }> {
  const resolved = resolveOptions(options);
  const doc = await loadDocument(resolved);
  const model = await normalizeDocument(doc, resolved);
  const diagnostics = doc.diagnostics;
  return {
    model,
    diagnostics,
    index: new OperationIndex(model.operations, resolved.routing.trailingSlash, (message) => {
      diagnostics.reportWarning('spec.path_collision', message);
    }),
  };
}

export async function indexFor(document: Doc, routing: LoadOpenApiContractOptions['routing'] = {}) {
  return (await normalized({ document, routing })).index;
}
