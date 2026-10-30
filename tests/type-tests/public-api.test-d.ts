import { expectTypeOf } from 'expect-type';
import type {
  ContractIssue,
  ContractValidationResult,
  HttpExchange,
  IssueCode,
  LoadOpenApiContractOptions,
  OpenApiContract,
} from '../../src/index.js';
import type { OpenApiContractAssertionError } from '../../src/index.js';

type Contract = OpenApiContract;

expectTypeOf<Contract['validateResponse']>().parameter(0).toEqualTypeOf<HttpExchange>();
expectTypeOf<Contract['validateResponse']>().returns.toEqualTypeOf<ContractValidationResult>();
expectTypeOf<Contract['assertResponse']>().returns.toBeVoid();
expectTypeOf<
  Contract['createAssertionError']
>().returns.toEqualTypeOf<OpenApiContractAssertionError>();
expectTypeOf<ContractIssue['code']>().toEqualTypeOf<IssueCode>();
expectTypeOf<ContractIssue['severity']>().toEqualTypeOf<'error' | 'warning'>();
expectTypeOf<OpenApiContractAssertionError['result']>().toEqualTypeOf<ContractValidationResult>();

// Valid exchange shapes
const exchange = {
  request: { method: 'GET', url: new URL('http://localhost/users/1') },
  response: { status: 200, headers: new Headers(), body: null, bodyPresent: true },
} satisfies HttpExchange;
expectTypeOf(exchange).toExtend<HttpExchange>();

const options = {
  source: './openapi.yaml',
  refs: { rootDir: '.', maxFiles: 10 },
  validation: { unsupportedFeaturePolicy: 'warning', writeOnlyInResponse: 'ignore' },
  routing: { trailingSlash: 'ignore' },
} satisfies LoadOpenApiContractOptions;
expectTypeOf(options).toExtend<LoadOpenApiContractOptions>();

type Refs = NonNullable<LoadOpenApiContractOptions['refs']>;
// Remote references are not part of v1.
expectTypeOf<keyof Refs>().toEqualTypeOf<'rootDir' | 'maxFiles' | 'maxBytesPerFile'>();

// @ts-expect-error unknown issue code
export const badCode: IssueCode = 'response.nope';

// @ts-expect-error status must be a number
export const badStatus: HttpExchange['response'] = { status: '200' };
