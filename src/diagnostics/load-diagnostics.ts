import type { ContractIssue, UnsupportedFeaturePolicy } from '../public-types.js';
import { OpenApiSpecError } from './errors.js';
import { createIssue } from './issue-factory.js';

/**
 * Collects features found in the contract that this package cannot validate. Nothing is dropped
 * silently: depending on the policy they become load errors or warnings on the contract.
 */
export class LoadDiagnostics {
  private readonly unsupported: ContractIssue[] = [];

  reportUnsupported(message: string, extras: Partial<ContractIssue> = {}): void {
    this.unsupported.push(createIssue('spec.unsupported_feature', message, extras));
  }

  get count(): number {
    return this.unsupported.length;
  }

  /** Throws under policy `'error'`; otherwise returns the issues downgraded to warnings. */
  finalize(policy: UnsupportedFeaturePolicy): ContractIssue[] {
    const sorted = [...this.unsupported].sort((a, b) =>
      `${a.schemaPath ?? ''}${a.message}`.localeCompare(`${b.schemaPath ?? ''}${b.message}`),
    );
    if (policy === 'error' && sorted.length > 0) {
      throw new OpenApiSpecError(
        `The OpenAPI document uses features that are not supported:\n${sorted
          .map((i) => `- ${i.message}`)
          .join(
            '\n',
          )}\nSet validation.unsupportedFeaturePolicy to 'warning' to load the contract anyway.`,
        sorted,
      );
    }
    return sorted.map((issue) => ({ ...issue, severity: 'warning' as const }));
  }
}
