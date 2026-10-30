import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedOptions } from '../contract/contract-options.js';
import { OpenApiConfigError, OpenApiSpecError } from '../diagnostics/errors.js';
import { createIssue } from '../diagnostics/issue-factory.js';
import { LoadDiagnostics } from '../diagnostics/load-diagnostics.js';
import { deepFreeze } from '../utils/deep-freeze.js';
import { ReferenceResolver } from './reference-resolver.js';
import { detectVersion, validateDocumentStructure } from './spec-validator.js';
import type { OasVersion } from './spec-validator.js';
import { detectFormat, parseDocumentText } from './yaml-json-parser.js';

export interface LoadedDocument {
  version: OasVersion;
  /** The exact `openapi` string of the document, e.g. `3.1.1`. */
  openapi: string;
  /** Private snapshot of the document: later changes to a user supplied object do not affect it. */
  root: Record<string, unknown>;
  rootKey: string;
  resolver: ReferenceResolver;
  diagnostics: LoadDiagnostics;
  /** Path of the entry file, when loaded from `source`. */
  file: string | undefined;
}

const IN_MEMORY_KEY = '<document>';

const KNOWN_DIALECT_PREFIXES: Record<OasVersion, readonly string[]> = {
  '3.0': [],
  '3.1': [
    'https://spec.openapis.org/oas/3.1/dialect/',
    'https://json-schema.org/draft/2020-12/schema',
  ],
  '3.2': [
    'https://spec.openapis.org/oas/3.2/dialect/',
    'https://json-schema.org/draft/2020-12/schema',
  ],
};

/** Reads, parses and structurally validates the entry document and prepares reference resolution. */
export async function loadDocument(options: ResolvedOptions): Promise<LoadedDocument> {
  const { input, refs } = options;
  let data: unknown;
  let rootKey = IN_MEMORY_KEY;
  let file: string | undefined;
  let rootDir: string | undefined =
    refs.rootDir === undefined ? undefined : path.resolve(refs.rootDir);
  let docDir: string | undefined;

  if (input.kind === 'file') {
    const real = await realpathOrThrow(path.resolve(input.path));
    const text = await readEntryFile(real, refs.maxBytesPerFile, input.path);
    rootDir ??= path.dirname(real);
    if (!isInside(rootDir, real)) {
      throw new OpenApiConfigError('The "source" file is outside "refs.rootDir".');
    }
    data = parseDocumentText(text, detectFormat(real, text), path.basename(real));
    rootKey = real;
    file = real;
    docDir = path.dirname(real);
  } else if (input.kind === 'content') {
    if (Buffer.byteLength(input.content, 'utf8') > refs.maxBytesPerFile) {
      throw new OpenApiConfigError(
        `"content" exceeds the ${refs.maxBytesPerFile} byte limit (refs.maxBytesPerFile).`,
      );
    }
    data = parseDocumentText(input.content, input.contentType, 'content');
  } else {
    try {
      data = structuredClone(input.document);
    } catch {
      throw new OpenApiConfigError(
        '"document" must contain only plain JSON data (no functions or symbols).',
      );
    }
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    const message = 'The OpenAPI document must be an object at the top level.';
    throw new OpenApiSpecError(message, [createIssue('spec.invalid', message)]);
  }
  const root = deepFreeze(data as Record<string, unknown>);

  if (input.kind !== 'file') {
    const base = options.baseDir === undefined ? undefined : path.resolve(options.baseDir);
    rootDir ??= base;
    docDir = base ?? rootDir;
  }

  const { version, openapi } = detectVersion(root);
  const structural = validateDocumentStructure(root, version, options.validation.maxErrors);
  if (structural.length > 0) {
    throw new OpenApiSpecError(
      `The OpenAPI document is not valid:\n${structural.map((i) => `- ${i.message}`).join('\n')}`,
      structural,
    );
  }

  const diagnostics = new LoadDiagnostics();
  reportDocumentFeatures(root, version, diagnostics);

  const resolver = new ReferenceResolver(
    { rootDir, maxFiles: refs.maxFiles, maxBytesPerFile: refs.maxBytesPerFile },
    { key: rootKey, data: root, dir: docDir },
  );
  await resolver.init();
  return { version, openapi, root, rootKey, resolver, diagnostics, file };
}

function reportDocumentFeatures(
  root: Record<string, unknown>,
  version: OasVersion,
  diagnostics: LoadDiagnostics,
): void {
  const dialect = root['jsonSchemaDialect'];
  if (typeof dialect === 'string') {
    const known = KNOWN_DIALECT_PREFIXES[version].some((prefix) => dialect.startsWith(prefix));
    if (!known) {
      diagnostics.reportUnsupported(
        `jsonSchemaDialect "${dialect}" is not supported; only the OpenAPI ${version} dialect and JSON Schema 2020-12 are.`,
        { schemaPath: '/jsonSchemaDialect' },
      );
    }
  }
  if (version === '3.2' && typeof root['$self'] === 'string') {
    diagnostics.reportUnsupported(
      '"$self" is not supported: relative references are resolved against the file location, not the $self URI.',
      { schemaPath: '/$self' },
    );
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function realpathOrThrow(target: string): Promise<string> {
  try {
    return await realpath(target);
  } catch {
    throw new OpenApiConfigError(`OpenAPI source file "${target}" was not found.`);
  }
}

async function readEntryFile(file: string, max: number, label: string): Promise<string> {
  const handle = await open(file, 'r');
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new OpenApiConfigError(`"${label}" is not a regular file.`);
    if (stats.size > max) {
      throw new OpenApiConfigError(
        `OpenAPI source "${path.basename(file)}" exceeds the ${max} byte limit (refs.maxBytesPerFile).`,
      );
    }
    return await handle.readFile({ encoding: 'utf8' });
  } finally {
    await handle.close();
  }
}
