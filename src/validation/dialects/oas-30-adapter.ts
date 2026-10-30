import { Ajv04 } from '../../utils/ajv-modules.js';
import { baseAjvOptions, configureAjv } from './schema-dialect-adapter.js';
import type { SchemaDialectAdapter } from './schema-dialect-adapter.js';

/**
 * OAS 3.0 Schema Object = extended subset of JSON Schema draft-04 (boolean exclusiveMinimum/Maximum),
 * so it is validated by a draft-04 Ajv instance. `nullable` is translated by the transformer.
 */
export const oas30Adapter: SchemaDialectAdapter = {
  version: '3.0',
  booleanSchemas: false,
  refSiblingsApply: false,
  schemaKeywords: new Set(['items', 'additionalProperties', 'not']),
  schemaArrayKeywords: new Set(['allOf', 'anyOf', 'oneOf']),
  schemaMapKeywords: new Set(['properties']),
  plainKeywords: new Set([
    'type',
    'enum',
    'required',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    'minLength',
    'maxLength',
    'pattern',
    'format',
    'minItems',
    'maxItems',
    'uniqueItems',
    'minProperties',
    'maxProperties',
    'title',
    'description',
    'default',
    'example',
    'deprecated',
    'readOnly',
    'writeOnly',
    'xml',
    'externalDocs',
  ]),
  createAjv(options) {
    const ajv = new Ajv04(baseAjvOptions(options.validateFormats, options.onPatternFallback));
    configureAjv(ajv, options);
    return ajv;
  },
};
