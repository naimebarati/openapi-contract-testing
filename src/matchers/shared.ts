import { OpenApiInputError } from '../diagnostics/errors.js';
import { formatValidationResult } from '../diagnostics/format-result.js';
import type { HttpExchange, OpenApiContract } from '../public-types.js';

export interface MatcherResult {
  pass: boolean;
  message: () => string;
}

function isContract(value: unknown): value is OpenApiContract {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { validateResponse?: unknown }).validateResponse === 'function'
  );
}

/**
 * Runner-independent matcher body: a thin wrapper over `contract.validateResponse()`. It contains no
 * validation logic, so Jest and Vitest cannot disagree with the core API.
 *
 * `message` is used both for failures and for failed `.not` assertions, so it depends on `pass`.
 */
export function toConformToOpenApi(received: unknown, contract: unknown): MatcherResult {
  if (!isContract(contract)) {
    throw new OpenApiInputError(
      'toConformToOpenApi() expects an OpenApiContract as its argument, for example: expect(exchange).toConformToOpenApi(await loadOpenApiContract({ source: "openapi.yaml" })).',
    );
  }
  if (typeof received !== 'object' || received === null) {
    throw new OpenApiInputError(
      'toConformToOpenApi() expects the received value to be an HTTP exchange: { request: { method, url }, response: { status, headers, body } }. Adapters such as fromSupertest() build one from a client response.',
    );
  }
  const result = contract.validateResponse(received as HttpExchange);
  if (result.valid) {
    const operation = result.operation
      ? `${result.operation.method} ${result.operation.path}${result.operation.operationId ? ` (operationId: ${result.operation.operationId})` : ''}`
      : 'the contract';
    return {
      pass: true,
      message: () =>
        `Expected the response not to conform to the OpenAPI contract, but it conforms to ${operation}.`,
    };
  }
  return { pass: false, message: () => formatValidationResult(result) };
}

export const matchers = { toConformToOpenApi };
