import { OpenApiContractAssertionError } from '../diagnostics/errors.js';
import { formatValidationResult } from '../diagnostics/format-result.js';
import { loadDocument } from '../loader/load-document.js';
import { normalizeDocument } from '../normalize/normalize-document.js';
import { OperationIndex } from '../routing/operation-index.js';
import { compileContract } from '../validation/compile-contract.js';
import { ResponseValidator } from '../validation/validate-response.js';
import type {
  ContractIssue,
  ContractValidationResult,
  HttpExchange,
  LoadOpenApiContractOptions,
  OpenApiContract,
  OperationSummary,
} from '../public-types.js';
import { resolveOptions } from './contract-options.js';

/**
 * Loads, validates and compiles an OpenAPI document once. The returned contract is immutable and keeps no
 * state between calls, so it can be shared by concurrent tests.
 */
export async function loadOpenApiContract(
  options: LoadOpenApiContractOptions,
): Promise<OpenApiContract> {
  const resolved = resolveOptions(options);
  const doc = await loadDocument(resolved);
  const model = await normalizeDocument(doc, resolved);
  const index = new OperationIndex(model.operations, resolved.routing.trailingSlash);
  const compiled = await compileContract(doc, model, resolved);
  // After compilation: it can still report unsupported features. Throws under policy 'error'.
  const warnings: readonly ContractIssue[] = Object.freeze(
    doc.diagnostics.finalize(resolved.validation.unsupportedFeaturePolicy),
  );
  const validator = new ResponseValidator(index, compiled, resolved);
  const operations: readonly OperationSummary[] = Object.freeze(
    model.operations.map((op) =>
      Object.freeze({
        method: op.method,
        path: op.path,
        ...(op.operationId === undefined ? {} : { operationId: op.operationId }),
        responses: [...op.responses.keys],
      }),
    ),
  );

  const createAssertionError = (result: ContractValidationResult): OpenApiContractAssertionError =>
    new OpenApiContractAssertionError(formatValidationResult(result), result);

  return Object.freeze({
    validateResponse: (exchange: HttpExchange) => validator.validate(exchange),
    assertResponse(exchange: HttpExchange): void {
      const result = validator.validate(exchange);
      if (!result.valid) throw createAssertionError(result);
    },
    createAssertionError,
    getOperations: () => operations,
    getWarnings: () => warnings,
  });
}
