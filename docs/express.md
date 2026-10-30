# Express

Test your Express app with Supertest (no server port needed) or `fetch` against a running instance.

```ts
import request from 'supertest';
import { loadOpenApiContract } from 'openapi-contract-testing';
import { fromSupertest } from 'openapi-contract-testing/adapters/supertest';

const contract = await loadOpenApiContract({ source: './openapi.yaml' });

it('GET /api/v1/users/:id follows the contract', async () => {
  const url = '/api/v1/users/123';
  const response = await request(app).get(url);
  contract.assertResponse(fromSupertest(response, { method: 'GET', url }));
});
```

`fromSupertest` needs the request passed explicitly (Supertest does not reliably expose it). It decides whether a
body exists from `response.text`, because Superagent reports `body: {}` for responses without a payload.

If you prefer to build the exchange yourself:

```ts
const result = contract.validateResponse({
  request: { method: 'GET', url },
  response: {
    status: response.status,
    headers: response.headers,
    body: response.body,
    bodyPresent: response.text.length > 0,
  },
});
```

## Seeing invalid JSON

Superagent throws while parsing a response that claims to be JSON but is not, so your test fails before the
contract is consulted. To get a `response.body.invalid_json` diagnostic instead, keep the payload as text:

```ts
function textParser(res, callback) {
  let data = '';
  res.setEncoding('utf8');
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    callback(null, data);
  });
}
const response = await request(app).get(url).buffer(true).parse(textParser);
```

`fromSupertest` treats a string `body` without `text` as the raw payload.

## Against a running server

```ts
const response = await fetch(`http://127.0.0.1:${port}/api/v1/users/123`);
const exchange = await fromFetch({ method: 'GET', url: response.url }, response);
```

## Prefixes

If your app mounts routes under `/api/v1`, the contract must say so: `servers: [{ url: /api/v1 }]` or generated
paths that include the prefix. Otherwise pass `routing: { basePath: '/api/v1' }`. Nothing is guessed.
