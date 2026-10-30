import type { DataValidateFunction } from 'ajv/dist/types/index.js';
import type { ValidateFunction } from 'ajv';
import type { AjvInstance } from '../../utils/ajv-modules.js';
import { addFormats } from '../../utils/ajv-modules.js';
import type { OasVersion } from '../../loader/spec-validator.js';

export interface DialectAjvOptions {
  validateFormats: boolean;
  customFormats: Record<string, RegExp | ((value: string) => boolean)>;
}

/**
 * Everything that differs between OpenAPI Schema Object dialects. The transformer asks the adapter
 * which keywords exist and where subschemas live; the adapter builds the matching Ajv instance.
 * Ajv cannot mix draft-04 and 2020-12 in one instance, so every dialect gets its own.
 */
export interface SchemaDialectAdapter {
  readonly version: OasVersion;
  /** Keywords whose value is a single schema. */
  readonly schemaKeywords: ReadonlySet<string>;
  /** Keywords whose value is an array of schemas. */
  readonly schemaArrayKeywords: ReadonlySet<string>;
  /** Keywords whose value is a map of name -> schema. */
  readonly schemaMapKeywords: ReadonlySet<string>;
  /** Keywords copied unchanged (assertions and annotations understood by the Ajv instance). */
  readonly plainKeywords: ReadonlySet<string>;
  /** Boolean schemas (`true` / `false`) are valid schemas. */
  readonly booleanSchemas: boolean;
  /** `{$ref, ...siblings}`: siblings are evaluated alongside the reference. */
  readonly refSiblingsApply: boolean;
  /** Registry property under which definitions are stored (`definitions` or `$defs`). */
  createAjv(options: DialectAjvOptions): AjvInstance;
}

/** OpenAPI-specific annotation keywords: accepted, never asserted. */
export const OAS_ANNOTATION_KEYWORDS = [
  'discriminator',
  'xml',
  'externalDocs',
  'example',
  'readOnly',
  'writeOnly',
  'deprecated',
] as const;

/** Custom keyword implementing `writeOnlyInResponse`; fails whenever the property is present. */
export const WRITE_ONLY_KEYWORD = 'octWriteOnly';

/** Reference resolved on first use; used for cycle-closing references (see `SchemaRegistry.linkAndOrder`). */
export const LAZY_REF_KEYWORD = 'octRef';

export function baseAjvOptions(validateFormats: boolean) {
  return {
    // Unknown keywords throw instead of being ignored; the transformer reports them first with a location.
    strictSchema: true,
    // These two are style lints that reject valid, common OpenAPI (see ADR-0003).
    strictTypes: false,
    strictRequired: false,
    strictTuples: false,
    allErrors: true,
    // Errors carry `parentSchema`, which is how they are traced back to the contract (schema-errors.ts).
    verbose: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
    validateFormats,
    allowUnionTypes: true,
    discriminator: false,
    // Always compile validators from the schema object, never from user supplied code.
    code: { optimize: true },
  } as const;
}

export function configureAjv(ajv: AjvInstance, options: DialectAjvOptions): void {
  addFormats(ajv);
  for (const [name, impl] of Object.entries(options.customFormats)) {
    ajv.addFormat(name, {
      type: 'string',
      validate: impl instanceof RegExp ? (value: string) => impl.test(value) : impl,
    });
  }
  for (const keyword of OAS_ANNOTATION_KEYWORDS) {
    // Some of them (readOnly, deprecated...) are already known to newer drafts.
    if (!isKnownKeyword(ajv, keyword)) ajv.addKeyword({ keyword });
  }
  ajv.addKeyword({
    keyword: LAZY_REF_KEYWORD,
    schemaType: 'string',
    errors: true,
    compile: (ref: string) => {
      let target: ValidateFunction | undefined;
      const validate: DataValidateFunction = (data, dataCxt) => {
        target ??= ajv.getSchema(ref);
        if (!target) throw new Error(`Unresolvable schema reference ${ref}`);
        if (target(data, dataCxt)) return true;
        validate.errors = target.errors ?? [];
        return false;
      };
      return validate;
    },
  });
  ajv.addKeyword({
    keyword: WRITE_ONLY_KEYWORD,
    schemaType: 'boolean',
    validate: () => false,
    errors: true,
  });
}

function isKnownKeyword(ajv: AjvInstance, keyword: string): boolean {
  try {
    ajv.addKeyword({ keyword });
    ajv.removeKeyword(keyword);
    return false;
  } catch {
    return true;
  }
}
