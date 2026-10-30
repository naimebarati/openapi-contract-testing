import type { IssueCode } from '../diagnostics/issue-codes.js';
import type { ContractIssue } from '../public-types.js';

/** Fields shared by every issue of one response validation. */
export interface IssueContext {
  base: Pick<ContractIssue, 'method' | 'actualPath' | 'status'> &
    Partial<Pick<ContractIssue, 'operationId' | 'pathTemplate'>>;
  includeActualValues: boolean;
}

export function makeIssue(
  context: IssueContext,
  code: IssueCode,
  message: string,
  extras: Partial<Omit<ContractIssue, 'code' | 'message'>> = {},
): ContractIssue {
  const issue: ContractIssue = { severity: 'error', ...context.base, ...extras, code, message };
  // Optional fields are omitted rather than present-but-undefined, so results serialize predictably.
  for (const key of Object.keys(issue) as (keyof ContractIssue)[]) {
    if (issue[key] === undefined) Reflect.deleteProperty(issue, key);
  }
  return issue;
}
