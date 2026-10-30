import { Ajv2020 } from '../../utils/ajv-modules.js';
import { baseAjvOptions, configureAjv } from './schema-dialect-adapter.js';
import type { SchemaDialectAdapter } from './schema-dialect-adapter.js';

/** OAS 3.1 Schema Object = JSON Schema 2020-12 plus OpenAPI annotation keywords. */
export const oas31Adapter: SchemaDialectAdapter = {
  version: '3.1',
  booleanSchemas: true,
  refSiblingsApply: true,
  schemaKeywords: new Set([
    'items',
    'additionalProperties',
    'not',
    'contains',
    'propertyNames',
    'if',
    'then',
    'else',
    'unevaluatedItems',
    'unevaluatedProperties',
    'contentSchema',
  ]),
  schemaArrayKeywords: new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']),
  schemaMapKeywords: new Set(['properties', 'patternProperties', '$defs', 'dependentSchemas']),
  plainKeywords: new Set([
    'type',
    'enum',
    'const',
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
    'dependentRequired',
    'minContains',
    'maxContains',
    'title',
    'description',
    'default',
    'example',
    'examples',
    'deprecated',
    'readOnly',
    'writeOnly',
    'xml',
    'externalDocs',
    'contentEncoding',
    'contentMediaType',
  ]),
  createAjv(options) {
    const ajv = new Ajv2020(baseAjvOptions(options.validateFormats));
    configureAjv(ajv, options);
    return ajv;
  },
};
