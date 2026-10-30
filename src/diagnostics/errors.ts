import type { ContractIssue, ContractValidationResult } from '../public-types.js';

/** Base class of every error thrown by this package. */
export class OpenApiContractError extends Error {
  override name = 'OpenApiContractError';
}

/** The contract document could not be loaded, resolved or compiled. No contract instance exists. */
export class OpenApiSpecError extends OpenApiContractError {
  override name = 'OpenApiSpecError';
  readonly issues: readonly ContractIssue[];

  constructor(message: string, issues: readonly ContractIssue[]) {
    super(message);
    this.issues = issues;
  }
}

/** Invalid options passed to the loader. */
export class OpenApiConfigError extends OpenApiContractError {
  override name = 'OpenApiConfigError';
}

/** A malformed exchange was passed to the validator (programming error, not a contract violation). */
export class OpenApiInputError extends OpenApiContractError {
  override name = 'OpenApiInputError';
}

/** Thrown by `assertResponse`; carries the structured result. */
export class OpenApiContractAssertionError extends OpenApiContractError {
  override name = 'OpenApiContractAssertionError';
  readonly result: ContractValidationResult;

  constructor(message: string, result: ContractValidationResult) {
    super(message);
    this.result = result;
  }
}
