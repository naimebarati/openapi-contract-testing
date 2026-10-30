import type { ResolvedOptions } from '../contract/contract-options.js';
import { createIssue } from '../diagnostics/issue-factory.js';
import type { OperationIndex } from '../routing/operation-index.js';
import { selectResponse } from '../routing/select-response.js';
import type { ContractIssue, ContractValidationResult, HttpExchange } from '../public-types.js';
import { extractRequestPath } from '../utils/url.js';
import type { CompiledContract } from './compile-contract.js';
import { prepareExchange } from './exchange.js';
import { makeIssue } from './issue-context.js';
import type { IssueContext } from './issue-context.js';
import { validateBody } from './validate-body.js';
import { validateHeaders } from './validate-headers.js';

/**
 * Validates one HTTP exchange against the compiled contract. Holds no per-call state, so it can be used
 * concurrently; it never mutates its input.
 */
export class ResponseValidator {
  constructor(
    private readonly index: OperationIndex,
    private readonly contract: CompiledContract,
    private readonly options: ResolvedOptions,
  ) {}

  validate(exchange: HttpExchange): ContractValidationResult {
    const started = performance.now();
    const prepared = prepareExchange(exchange);
    const { includeActualValues, maxErrors, maxBodyBytes } = this.options.validation;
    const finish = (
      issues: ContractIssue[],
      operation?: ContractValidationResult['operation'],
    ): ContractValidationResult => {
      const errors = issues.filter((i) => i.severity === 'error');
      const warnings = issues.filter((i) => i.severity === 'warning');
      if (errors.length > maxErrors) {
        const omitted = errors.length - maxErrors;
        errors.length = maxErrors;
        warnings.push({
          ...createIssue(
            'response.body.schema_invalid',
            `${omitted} more error(s) were omitted (validation.maxErrors is ${maxErrors}).`,
            {
              severity: 'warning',
              status: prepared.status,
            },
          ),
        });
      }
      return {
        valid: errors.length === 0,
        ...(operation ? { operation } : {}),
        errors,
        warnings,
        durationMs: performance.now() - started,
      };
    };

    const base: IssueContext['base'] = { method: prepared.method, status: prepared.status };
    const extracted = extractRequestPath(prepared.url, this.options.routing.baseUrl);
    if (!extracted.ok) {
      return finish([
        makeIssue(
          { base, includeActualValues },
          'request.invalid_url',
          `The request URL cannot be used: ${extracted.reason}.`,
        ),
      ]);
    }
    const path = extracted.path;
    const baseWithPath = { ...base, actualPath: path };
    const lookup = this.index.lookup(prepared.method, path);

    if (lookup.kind === 'invalid_path') {
      return finish([
        makeIssue(
          { base: baseWithPath, includeActualValues },
          'request.invalid_url',
          `The request path cannot be used: ${lookup.reason}.`,
        ),
      ]);
    }
    if (lookup.kind === 'not_found') {
      const documented =
        lookup.documentedMethods.length > 0
          ? ` The path is documented for ${lookup.documentedMethods.join(', ')}, but not for ${prepared.method}.`
          : '';
      return finish([
        makeIssue(
          { base: baseWithPath, includeActualValues },
          'operation.not_found',
          `No operation in the contract matches ${prepared.method} ${path}.${documented}${lookup.hint ? ` ${lookup.hint}` : ''}`,
          lookup.documentedMethods.length > 0
            ? { expected: { documentedMethods: lookup.documentedMethods } }
            : {},
        ),
      ]);
    }
    if (lookup.kind === 'ambiguous') {
      const candidates = lookup.routes.map(
        (r) => `${r.operation.method} ${r.prefix}${r.operation.path}`,
      );
      return finish([
        makeIssue(
          { base: baseWithPath, includeActualValues },
          'operation.ambiguous',
          `${prepared.method} ${path} matches several operations equally well: ${candidates.join(', ')}.`,
          { expected: { candidates } },
        ),
      ]);
    }

    const { operation } = lookup.route;
    const context: IssueContext = {
      base: {
        ...baseWithPath,
        pathTemplate: operation.path,
        ...(operation.operationId === undefined ? {} : { operationId: operation.operationId }),
      },
      includeActualValues,
    };
    const summary = {
      method: operation.method,
      path: operation.path,
      ...(operation.operationId === undefined ? {} : { operationId: operation.operationId }),
    };

    const response = selectResponse(operation.responses, prepared.status);
    if (!response) {
      return finish(
        [
          makeIssue(
            context,
            'response.status_not_documented',
            `Status ${prepared.status} is not documented for ${operation.method} ${operation.path}. Documented: ${
              operation.responses.keys.length > 0 ? operation.responses.keys.join(', ') : 'none'
            }.`,
            { expected: { statuses: [...operation.responses.keys] } },
          ),
        ],
        summary,
      );
    }

    const compiled = this.contract.responseOf(response);
    const issues = [
      ...validateHeaders(
        compiled.headers,
        prepared.responseHeaders,
        context,
        this.contract.compiler,
      ),
      ...validateBody({
        response: compiled,
        headers: prepared.responseHeaders,
        body: prepared.body,
        method: prepared.method,
        status: prepared.status,
        maxBodyBytes,
        compiler: this.contract.compiler,
        context,
      }),
    ];
    return finish(issues, summary);
  }
}
