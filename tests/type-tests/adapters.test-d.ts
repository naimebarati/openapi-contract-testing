import type { AxiosResponse } from 'axios';
import { expectTypeOf } from 'expect-type';
import type { HttpExchange } from '../../src/index.js';
import { fromAxios } from '../../src/adapters/axios.js';
import type { AxiosResponseLike } from '../../src/adapters/axios.js';
import { fromFastifyInject } from '../../src/adapters/fastify.js';
import { fromFetch } from '../../src/adapters/fetch.js';
import { fromSupertest } from '../../src/adapters/supertest.js';
import type { AdapterRequest } from '../../src/adapters/supertest.js';

expectTypeOf(fromFetch).returns.resolves.toEqualTypeOf<HttpExchange>();
expectTypeOf(fromSupertest).returns.toEqualTypeOf<HttpExchange>();
expectTypeOf(fromAxios).returns.toEqualTypeOf<HttpExchange>();
expectTypeOf(fromFastifyInject).returns.toEqualTypeOf<HttpExchange>();
expectTypeOf<AdapterRequest>().toEqualTypeOf<{ method: string; url: string | URL }>();

// Adapters accept the real client types without depending on them.
declare const fetchResponse: Response;
declare const fetchRequest: Request;
void fromFetch(fetchRequest, fetchResponse);
void fromFetch({ method: 'GET', url: '/x' }, fetchResponse);

declare const axiosResponse: AxiosResponse;
expectTypeOf(axiosResponse).toExtend<AxiosResponseLike>();
