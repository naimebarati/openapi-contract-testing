import { expect } from 'vitest';
import { resolveOptions } from '../../src/contract/contract-options.js';
import type { LoadDiagnostics } from '../../src/diagnostics/load-diagnostics.js';
import type { LoadOpenApiContractOptions } from '../../src/index.js';
import { loadDocument } from '../../src/loader/load-document.js';
import { SchemaCompiler } from '../../src/validation/schema-compiler.js';
import type { CompiledSchema } from '../../src/validation/schema-compiler.js';
import { oas } from './contracts.js';

export type Version = '3.0' | '3.1' | '3.2';
const OPENAPI: Record<Version, string> = { '3.0': '3.0.3', '3.1': '3.1.0', '3.2': '3.2.0' };

export interface Compiled {
  schema: CompiledSchema;
  diagnostics: LoadDiagnostics;
  errors: (value: unknown) => ReturnType<CompiledSchema['validate']>;
}

/** Compiles `subject` (placed at /components/schemas/Subject of a real, validated document). */
export async function compileSchema(
  subject: unknown,
  {
    version = '3.1',
    components = {},
    options = {},
    extra = {},
  }: {
    version?: Version;
    components?: Record<string, unknown>;
    options?: LoadOpenApiContractOptions;
    extra?: Record<string, unknown>;
  } = {},
): Promise<Compiled> {
  const document = oas(
    {},
    { components: { schemas: { ...components, Subject: subject } }, ...extra },
    OPENAPI[version],
  );
  const resolved = resolveOptions({ document, ...options });
  const doc = await loadDocument(resolved);
  const compiler = new SchemaCompiler(
    doc.version,
    doc.resolver,
    doc.rootKey,
    doc.diagnostics,
    resolved.validation,
  );
  const handle = await compiler.add({
    node: (doc.root['components'] as { schemas: Record<string, unknown> }).schemas['Subject'],
    loc: { docKey: doc.rootKey, pointer: '/components/schemas/Subject' },
  });
  compiler.build();
  const schema = compiler.get(handle);
  return { schema, diagnostics: doc.diagnostics, errors: (value) => schema.validate(value) };
}

export function accepts(compiled: Compiled, value: unknown): void {
  expect(compiled.errors(value), `should accept ${JSON.stringify(value)}`).toEqual([]);
}

export function rejects(compiled: Compiled, value: unknown): void {
  expect(compiled.errors(value).length, `should reject ${JSON.stringify(value)}`).toBeGreaterThan(
    0,
  );
}
