# Fastify

`app.inject()` needs no open port:

```ts
import { loadOpenApiContract } from 'openapi-contract-testing';
import { fromFastifyInject } from 'openapi-contract-testing/adapters/fastify';

const contract = await loadOpenApiContract({ source: './openapi.yaml' });
await app.ready();

const url = '/api/v1/users/123';
const response = await app.inject({ method: 'GET', url });
contract.assertResponse(fromFastifyInject(response, { method: 'GET', url }));
```

The adapter passes `rawPayload` on, so the body is parsed once, by the validator, according to the response
Content-Type. Repeated headers such as `set-cookie` stay separate values.

`@fastify/swagger` can produce a document with `app.swagger()` after `app.ready()`, which you can pass as `document`.
That combination is not covered by this package's tests. If such a document uses features listed in
[supported-features.md](supported-features.md) as unsupported, loading names them.
