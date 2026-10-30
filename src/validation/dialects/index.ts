import type { OasVersion } from '../../loader/spec-validator.js';
import { oas30Adapter } from './oas-30-adapter.js';
import { oas31Adapter } from './oas-31-adapter.js';
import { oas32Adapter } from './oas-32-adapter.js';
import type { SchemaDialectAdapter } from './schema-dialect-adapter.js';

export function adapterFor(version: OasVersion): SchemaDialectAdapter {
  switch (version) {
    case '3.0':
      return oas30Adapter;
    case '3.1':
      return oas31Adapter;
    case '3.2':
      return oas32Adapter;
  }
}

export type { SchemaDialectAdapter } from './schema-dialect-adapter.js';
