import type { ContractIssue } from '../public-types.js';
import type { IssueCode } from './issue-codes.js';

export function createIssue(
  code: IssueCode,
  message: string,
  extras: Partial<Omit<ContractIssue, 'code' | 'message'>> = {},
): ContractIssue {
  return { severity: 'error', ...extras, code, message };
}
