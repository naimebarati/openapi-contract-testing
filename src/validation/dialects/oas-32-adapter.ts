import { oas31Adapter } from './oas-31-adapter.js';
import type { SchemaDialectAdapter } from './schema-dialect-adapter.js';

/**
 * OAS 3.2 keeps the 3.1 (JSON Schema 2020-12) Schema Object vocabulary. What 3.2 adds to the Schema Object
 * (`xml.nodeType`, `discriminator.defaultMapping`) is annotation-level or handled in the transformer.
 */
export const oas32Adapter: SchemaDialectAdapter = { ...oas31Adapter, version: '3.2' };
