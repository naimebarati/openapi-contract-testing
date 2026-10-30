import Ajv2020Module from 'ajv/dist/2020.js';
import Ajv04Module from 'ajv-draft-04';
import addFormatsModule from 'ajv-formats';

/**
 * Ajv and its plugins are CommonJS packages that set both `module.exports` and `exports.default`.
 * Depending on the loader (Node ESM, CJS build, bundler) the default import is either the class or the
 * module namespace, so both shapes are handled here, once, with correct types.
 */
function unwrap<T>(module: T): T extends { default: infer D } ? D : T {
  const candidate = (module as { default?: unknown }).default;
  return (candidate ?? module) as T extends { default: infer D } ? D : T;
}

export const Ajv2020 = unwrap(Ajv2020Module);
export const Ajv04 = unwrap(Ajv04Module);
export const addFormats = unwrap(addFormatsModule);

export type AjvInstance = InstanceType<typeof Ajv2020> | InstanceType<typeof Ajv04>;
