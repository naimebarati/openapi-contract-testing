import type { ErrorObject, ValidateFunction } from 'ajv';
import type { LoadDiagnostics } from '../diagnostics/load-diagnostics.js';
import { OpenApiSpecError } from '../diagnostics/errors.js';
import { createIssue } from '../diagnostics/issue-factory.js';
import type { DocLocation, ReferenceResolver } from '../loader/reference-resolver.js';
import type { OasVersion } from '../loader/spec-validator.js';
import type { SchemaSource } from '../normalize/model.js';
import type { ContractIssue } from '../public-types.js';
import type { ResolvedOptions } from '../contract/contract-options.js';
import type { AjvInstance } from '../utils/ajv-modules.js';
import { adapterFor } from './dialects/index.js';
import { REGISTRY_URI, SchemaRegistry } from './schema-transformer.js';
import { toViolations } from './schema-errors.js';
import type { SchemaViolation } from './schema-errors.js';

export type { SchemaViolation } from './schema-errors.js';

/** Opaque reference to a schema registered with the compiler. */
export type SchemaHandle = string;

export interface CompiledSchema {
  readonly origin: DocLocation;
  /** Never mutates `data`. Returns an empty array when the value conforms. */
  validate(data: unknown): SchemaViolation[];
}

const DEFINITION_PATH = /^urn:oct:registry#\/definitions\/([se]\d+)(.*)$/;

/**
 * Compiles every schema the contract uses once, at load time, with the Ajv instance of the contract's
 * dialect. Compilation problems surface as `OpenApiSpecError` (`schema.compile_failed`) instead of
 * as failures at the first response.
 */
export class SchemaCompiler {
  private readonly ajv: AjvInstance;
  private readonly registry: SchemaRegistry;
  private readonly handles = new Map<SchemaHandle, DocLocation>();
  private readonly handleByLocation = new Map<string, SchemaHandle>();
  private readonly compiled = new Map<SchemaHandle, CompiledSchema>();
  private built = false;

  constructor(
    version: OasVersion,
    private readonly resolver: ReferenceResolver,
    private readonly rootKey: string,
    diagnostics: LoadDiagnostics,
    private readonly validation: ResolvedOptions['validation'],
  ) {
    const adapter = adapterFor(version);
    this.ajv = adapter.createAjv({
      validateFormats: validation.validateFormats,
      customFormats: validation.customFormats,
    });
    this.registry = new SchemaRegistry(resolver, adapter, diagnostics, {
      writeOnlyInResponse: validation.writeOnlyInResponse,
      validateFormats: validation.validateFormats,
      isKnownFormat: (format) => Object.hasOwn(this.ajv.formats, format),
    });
  }

  async add(source: SchemaSource): Promise<SchemaHandle> {
    if (this.built) throw new Error('SchemaCompiler.add() called after build()');
    // Responses shared through $ref reach here once per operation; the schema at a location is compiled once.
    const key = `${source.loc.docKey}#${source.loc.pointer}`;
    const known = this.handleByLocation.get(key);
    if (known !== undefined) return known;
    const handle = await this.registry.addEntry(source.node, source.loc);
    this.handles.set(handle, source.loc);
    this.handleByLocation.set(key, handle);
    return handle;
  }

  /** Validates all registered schemas against the dialect meta-schema and compiles them. */
  build(): void {
    this.built = true;
    for (const format of this.registry.unknownFormats) this.ajv.addFormat(format, true);

    const issues: ContractIssue[] = [];
    for (const [id, definition] of Object.entries(this.registry.definitions)) {
      if (!this.ajv.validateSchema(definition as object | boolean)) {
        const origin = this.registry.origins.get(id);
        for (const error of this.ajv.errors ?? []) {
          issues.push(
            this.compileIssue(
              origin,
              `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
            ),
          );
        }
      }
    }
    this.throwIfAny(issues, 'The contract contains invalid schemas');

    const order = this.registry.linkAndOrder();
    this.ajv.addSchema({ definitions: this.registry.definitions }, REGISTRY_URI, undefined, false);
    // Leaf-first: when a definition is compiled, everything it references natively is already compiled.
    for (const id of order) {
      try {
        this.ajv.getSchema(`${REGISTRY_URI}#/definitions/${id}`);
      } catch (error) {
        issues.push(this.compileIssue(this.registry.origins.get(id), (error as Error).message));
      }
    }
    this.throwIfAny(issues, 'The contract contains schemas that cannot be compiled');
    for (const [handle, origin] of this.handles) {
      const validate = this.ajv.getSchema(handle);
      if (!validate) throw new Error(`Schema ${handle} was not registered`);
      this.compiled.set(handle, this.wrap(validate, origin, handle));
    }
  }

  get(handle: SchemaHandle): CompiledSchema {
    const compiled = this.compiled.get(handle);
    if (!compiled) throw new Error(`Unknown schema handle ${handle}`);
    return compiled;
  }

  /** Resolves `$ref` chains of a registered schema and returns the plain schema node (for type sniffing). */
  peek(source: SchemaSource): Promise<{ node: unknown; loc: DocLocation }> {
    return this.registry.peek(source.node, source.loc);
  }

  private wrap(validate: ValidateFunction, origin: DocLocation, handle: string): CompiledSchema {
    const { includeActualValues, writeOnlyInResponse } = this.validation;
    const context = {
      originOf: (schema: unknown) => {
        const origin =
          typeof schema === 'object' && schema !== null
            ? this.registry.nodeOrigins.get(schema)
            : undefined;
        return origin && { path: this.locationPath(origin.loc), synthetic: origin.synthetic };
      },
      // Fallback. Errors raised directly in the entry schema carry paths relative to it.
      mapSchemaPath: (path: string) =>
        this.mapSchemaPath(path.startsWith('#') ? `${handle}${path.slice(1)}` : path),
      includeActualValues,
      writeOnlySeverity:
        writeOnlyInResponse === 'warning' ? ('warning' as const) : ('error' as const),
    };
    return {
      origin,
      validate: (data) => {
        if (validate(data)) return [];
        const errors: ErrorObject[] = [...(validate.errors ?? [])];
        // Ajv reports in schema keyword order; sort so the output does not depend on how the schema was written.
        return toViolations(errors, data, context).sort(
          (a, b) =>
            a.instancePath.localeCompare(b.instancePath) ||
            a.schemaPath.localeCompare(b.schemaPath) ||
            a.keyword.localeCompare(b.keyword) ||
            a.message.localeCompare(b.message),
        );
      },
    };
  }

  private locationPath(loc: DocLocation): string {
    return `${loc.docKey === this.rootKey ? '' : `${this.resolver.label(loc.docKey)}#`}${loc.pointer}`;
  }

  private mapSchemaPath(ajvPath: string): string {
    const match = DEFINITION_PATH.exec(ajvPath);
    const origin = match?.[1] === undefined ? undefined : this.registry.origins.get(match[1]);
    if (!match || !origin) return ajvPath;
    const file = origin.docKey === this.rootKey ? '' : `${this.resolver.label(origin.docKey)}#`;
    return `${file}${origin.pointer}${match[2] ?? ''}`;
  }

  private compileIssue(origin: DocLocation | undefined, detail: string): ContractIssue {
    const where =
      origin === undefined
        ? ''
        : ` at ${origin.docKey === this.rootKey ? '' : this.resolver.label(origin.docKey)}#${origin.pointer}`;
    return createIssue('schema.compile_failed', `Invalid schema${where}: ${detail}`, {
      ...(origin === undefined ? {} : { schemaPath: origin.pointer }),
    });
  }

  private throwIfAny(issues: ContractIssue[], title: string): void {
    if (issues.length === 0) return;
    const unique = [...new Map(issues.map((i) => [i.message, i])).values()].slice(
      0,
      this.validation.maxErrors,
    );
    throw new OpenApiSpecError(
      `${title}:\n${unique.map((i) => `- ${i.message}`).join('\n')}`,
      unique,
    );
  }
}
