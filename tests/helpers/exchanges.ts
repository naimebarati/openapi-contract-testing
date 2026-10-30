import { loadOpenApiContract } from '../../src/index.js';
import type {
  ContractValidationResult,
  HttpExchange,
  LoadOpenApiContractOptions,
  OpenApiContract,
} from '../../src/index.js';
import { oas } from './contracts.js';

type Doc = Record<string, unknown>;

export const json = { 'content-type': 'application/json' };

/** Loads a contract with a single `GET /thing` operation using the given responses. */
export async function contractFor(
  responses: Doc,
  {
    options = {},
    method = 'get',
    path = '/thing',
    openapi = '3.1.0',
    components,
    servers,
  }: {
    options?: LoadOpenApiContractOptions;
    method?: string;
    path?: string;
    openapi?: string;
    components?: Doc;
    servers?: unknown;
  } = {},
): Promise<OpenApiContract> {
  const document = oas(
    { [path]: { [method]: { operationId: 'thing', responses } } },
    { ...(components ? { components } : {}), ...(servers ? { servers } : {}) },
    openapi,
  );
  return loadOpenApiContract({ document, ...options });
}

export function response(
  status: number,
  extra: Partial<HttpExchange['response']> = {},
  request: Partial<HttpExchange['request']> = {},
): HttpExchange {
  return { request: { method: 'GET', url: '/thing', ...request }, response: { status, ...extra } };
}

export const codes = (result: ContractValidationResult): string[] =>
  result.errors.map((e) => e.code);
