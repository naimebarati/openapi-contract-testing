# openapi-contract-testing

Check that **real HTTP responses** conform to an **OpenAPI 3.0, 3.1 or 3.2** document, in your existing tests and
in CI. Independent of any web framework, HTTP client or test runner.

> **Status: pre-release (`0.1.0-beta.1`).** The API may still change before 1.0. The package name is provisional
> until availability and trademark checks are completed (see [docs/release-checklist.md](docs/release-checklist.md)).
> This project is not affiliated with the OpenAPI Initiative.

```text
OpenAPI response contract failed

GET /api/v1/users/123 (operation: GET /users/{id}, operationId: getUser)
Actual response: 200 OK

1. response.header_missing
   Header: X-Request-Id
   Message: Required response header "X-Request-Id" is missing.

2. response.body.schema_invalid
   Path: $.email
   Media type: application/json
   Message: must be string (received integer)
   Expected: {"type":"string"}
   Contract: /components/schemas/User/properties/email/type
```

## Why

You send a request to your API (NestJS, Express, Fastify, ...) and want to know whether the answer still matches
the contract you published. The package finds the operation from the **method and URL**, then checks the
**status code**, **headers**, **Content-Type** and **body**, and reports every problem separately with the
endpoint, `operationId`, status and JSON path.

It is a **provider-side contract testing** tool for test suites. It is not a request validator, not a production
middleware, and not a replacement for Pact (consumer-driven contracts), Schemathesis (generated tests) or
Spectral/Redocly (linting the OpenAPI file itself).

## Install

```bash
npm install --save-dev openapi-contract-testing
```

Requires **Node.js >= 22.12**. ESM and CommonJS are both supported. Runtime dependencies: `ajv`, `ajv-draft-04`,
`ajv-formats`, `yaml`. Jest and Vitest are only needed if you import the matchers; frameworks and HTTP clients are
never required.

## Quick start (Node `fetch`)

```ts
import { loadOpenApiContract } from 'openapi-contract-testing';
import { fromFetch } from 'openapi-contract-testing/adapters/fetch';

// Load once: the document is parsed, validated and every schema is compiled up front.
const contract = await loadOpenApiContract({ source: './openapi.yaml' });

const url = 'http://localhost:3000/api/v1/users/123';
const response = await fetch(url);

// The adapter reads response.clone(), so you can still read `response` yourself.
const exchange = await fromFetch({ method: 'GET', url }, response);

contract.assertResponse(exchange); // throws OpenApiContractAssertionError with a readable report
// or, without throwing:
const result = contract.validateResponse(exchange);
if (!result.valid) console.log(result.errors);
```

`loadOpenApiContract` accepts exactly one of `source` (a local file path), `document` (an already parsed object)
or `content` (raw YAML/JSON text, with `contentType`).

### The exchange model

Everything is built on a framework-neutral snapshot, so you can also create it yourself:

```ts
contract.validateResponse({
  request: { method: 'GET', url: '/api/v1/users/123' }, // path or absolute URL; query/fragment are ignored
  response: {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-request-id': 'abc' }, // object, Headers or entries
    body: { id: '123' }, // already parsed (object, array, string, number, null...)
    // or: rawBody: '{"id":"123"}' // unparsed text/bytes, parsed according to Content-Type
    bodyPresent: true, // tells "no body" apart from an empty one or JSON null
  },
});
```

`body` and `rawBody` are mutually exclusive (a contradiction is rejected, not guessed). A `body` you pass is never
parsed again: `body: 'hello'` for a JSON response is the JSON string `"hello"`. Nothing in your input is mutated.

A runnable example (Express + Supertest + Vitest, including a deliberately broken API) is in
[examples/](examples/README.md).

## Adapters

Adapters only convert a client response into an exchange; no OpenAPI logic is duplicated in them. They are
structurally typed, so the frameworks are **not** dependencies.

| Import                                        | Function                                       | Notes                                                                   |
| --------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| `openapi-contract-testing/adapters/fetch`     | `fromFetch(request, response, options?)`       | Uses `response.clone()`; reads at most `maxBodyBytes + 1` bytes.        |
| `openapi-contract-testing/adapters/supertest` | `fromSupertest(response, { method, url })`     | Request is passed explicitly; body presence comes from `response.text`. |
| `openapi-contract-testing/adapters/axios`     | `fromAxios(response, request?)`                | Combines `baseURL` and `url`; interprets `responseType`.                |
| `openapi-contract-testing/adapters/fastify`   | `fromFastifyInject(response, { method, url })` | Passes the raw payload on; parsed once by the validator.                |

### NestJS + Supertest

NestJS can generate the contract from your application, or you can use an exported file.

```ts
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import request from 'supertest';
import { loadOpenApiContract } from 'openapi-contract-testing';
import { fromSupertest } from 'openapi-contract-testing/adapters/supertest';

const app = moduleRef.createNestApplication();
app.setGlobalPrefix('api/v1');
await app.init();

// Paths in the generated document include the global prefix, so nothing is guessed.
const document = SwaggerModule.createDocument(
  app,
  new DocumentBuilder().setTitle('API').setVersion('1').build(),
);
const contract = await loadOpenApiContract({
  document: document as unknown as Record<string, unknown>,
});

const url = '/api/v1/users/123';
const response = await request(app.getHttpServer()).get(url);
contract.assertResponse(fromSupertest(response, { method: 'GET', url }));
```

More: [docs/nestjs.md](docs/nestjs.md). The package itself never depends on `@nestjs/*`.

### Express

```ts
import request from 'supertest';
const url = '/api/v1/users/123';
const response = await request(app).get(url);
contract.assertResponse(fromSupertest(response, { method: 'GET', url }));
```

See [docs/express.md](docs/express.md), including how to observe invalid JSON.

### Fastify

```ts
import { fromFastifyInject } from 'openapi-contract-testing/adapters/fastify';

const url = '/api/v1/users/123';
const response = await app.inject({ method: 'GET', url });
contract.assertResponse(fromFastifyInject(response, { method: 'GET', url }));
```

### Axios

```ts
import axios from 'axios';
import { fromAxios } from 'openapi-contract-testing/adapters/axios';

const client = axios.create({
  baseURL: 'http://localhost:3000/api/v1',
  validateStatus: () => true,
});
const response = await client.get('/users/123', { responseType: 'arraybuffer' }); // exact payload
contract.assertResponse(fromAxios(response));
```

Use `validateStatus: () => true` so error responses (4xx/5xx) are returned and can be checked. With the default
`responseType: 'json'` Axios hides invalid JSON by returning the text; use `'text'` or `'arraybuffer'` when you need
JSON syntax errors reported. `stream`, `blob` and `document` are rejected because they cannot be snapshotted
without consuming them.

## Jest

```ts
// jest.setup.ts  (add to `setupFilesAfterEnv`)
import 'openapi-contract-testing/jest';
```

```ts
const exchange = fromSupertest(await request(app).get(url), { method: 'GET', url });
expect(exchange).toConformToOpenApi(contract);
expect(badExchange).not.toConformToOpenApi(contract);
```

With `injectGlobals: false` register it yourself: `expect.extend(matchers)` with
`import { matchers } from 'openapi-contract-testing/jest'`. Types augment both `@types/jest` and `@jest/globals`.
Tested with Jest 30 (CommonJS). Details: [docs/jest.md](docs/jest.md).

## Vitest

```ts
// vitest.setup.ts  (add to `test.setupFiles`)
import 'openapi-contract-testing/vitest';
```

`expect(exchange).toConformToOpenApi(contract)` works with `.not`, `.resolves` and as an asymmetric matcher.
Tested with Vitest 5 (`vitest` is an optional peer dependency). Details: [docs/vitest.md](docs/vitest.md).

The matchers are thin wrappers over `contract.validateResponse()`; there is no second implementation of the rules.

## What is checked

1. **Operation**: HTTP method + path template (`/users/{id}`), `servers` and base paths, static paths before
   parameters. Nothing is guessed: `/api/v1` is only a prefix if your `servers` (or `routing.basePath`) say so.
2. **Status**: exact (`200`), range (`2XX`), then `default`.
3. **Headers**: required/optional response headers declared in the contract, with their schemas.
4. **Content-Type**: exact media type, then `type/*`, then `*/*`; parameters such as `charset` are ignored.
   `application/problem+json` is parsed as JSON but is **not** treated as `application/json`.
5. **Body**: presence (absent, empty and JSON `null` are different), JSON syntax, and the JSON Schema.

## Supported OpenAPI features

Full detail in [docs/supported-features.md](docs/supported-features.md).

| Area                                     |   OpenAPI 3.0   | OpenAPI 3.1 | OpenAPI 3.2 | Notes                                                                       |
| ---------------------------------------- | :-------------: | :---------: | :---------: | --------------------------------------------------------------------------- |
| Document structure validation            |       yes       |     yes     |     yes     | Official OpenAPI JSON Schemas                                               |
| Schema dialect                           | draft-04 subset |   2020-12   |   2020-12   | Separate validator instances; `nullable`, boolean `exclusiveMin/Max` in 3.0 |
| `$ref` (local, relative files)           |       yes       |     yes     |     yes     | Confined to a root directory                                                |
| Circular references                      |       yes       |     yes     |     yes     | Large graphs compile without stack overflows                                |
| `readOnly` / `writeOnly`                 |       yes       |     yes     |     yes     | Response direction; policy `writeOnlyInResponse`                            |
| `discriminator` with `oneOf`/`anyOf`     |       yes       |     yes     |     yes     | Dispatches on the property; `defaultMapping` in 3.2                         |
| Formats                                  |       yes       |     yes     |     yes     | `ajv-formats`, plus your own via `customFormats`                            |
| `QUERY` and `additionalOperations`       |        -        |      -      |     yes     | Routing only                                                                |
| `itemSchema`, `$self`, streaming types   |        -        |      -      |  reported   | Reported as `spec.unsupported_feature`, never ignored                       |
| Remote `$ref` and URL sources            |    not in v1    |  not in v1  |  not in v1  | Rejected explicitly (see security)                                          |
| Request validation, Swagger 2.0, GraphQL |       no        |     no      |     no      | Out of scope                                                                |

Anything the package cannot validate is **reported**, never silently skipped. By default
(`validation.unsupportedFeaturePolicy: 'error'`) loading fails with a message naming the feature and where it is;
set `'warning'` to load anyway and read `contract.getWarnings()`.

## `$ref` policy and security

- Local references (`#/...`) and **relative file references** are supported.
- Files are only read **inside a root directory** (default: the directory of `source`; for `document`/`content`
  inputs set `baseDir` or `refs.rootDir`, otherwise file references are refused). Paths are compared by `realpath`,
  so `..` traversal and symlink escapes are refused with `reference.not_allowed`.
- `http:`, `https:`, `file:` and every other URL scheme are **refused**. Remote references and URL sources are not
  implemented in this version because a trustworthy SSRF defence was out of scope; `refs.allowRemote` is rejected.
- Limits: `refs.maxFiles` (50) and `refs.maxBytesPerFile` (5 MiB); YAML alias expansion is bounded.
- Validation never performs network requests and never modifies your document, request or response.
- Diagnostics do not contain response values by default. Set `validation.includeActualValues: true` to include
  truncated actual values; sensitive headers (`Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`, ...) stay
  redacted even then.
- A `pattern` or custom format from your contract is executed as JavaScript; hostile regular expressions can be slow
  (no timeout is possible in-process). Only load contracts you trust.

See [docs/security.md](docs/security.md).

## Limitations of body types

| Content                               | What is checked                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `application/json`, `*+json`          | Syntax and full schema validation                                                                     |
| `text/*` (not XML/HTML)               | Schema validation of the text; `integer`/`number`/`boolean` schemas are parsed strictly from the text |
| XML, HTML, binary, multipart, streams | Content-Type, presence and size only; reported as warning `response.body_validation_unsupported`      |

`validation.maxBodyBytes` (default 10 MiB) bounds raw payloads; larger ones are reported as
`response.body_too_large` and not parsed. Parsed `body` objects cannot be measured and are not limited.

## Options

```ts
await loadOpenApiContract({
  source: './openapi.yaml', // or document / content + contentType
  baseDir: '.', // resolves file refs for document/content inputs
  refs: { rootDir, maxFiles: 50, maxBytesPerFile: 5 * 1024 * 1024 },
  validation: {
    validateFormats: true,
    customFormats: { 'currency-code': /^[A-Z]{3}$/ }, // sync only
    maxErrors: 100,
    maxBodyBytes: 10 * 1024 * 1024,
    unsupportedFeaturePolicy: 'error', // or 'warning'
    includeActualValues: false,
    writeOnlyInResponse: 'error', // or 'warning' | 'ignore'
  },
  routing: { baseUrl, basePath, trailingSlash: 'strict', serverIndex },
});
```

- Ajv runs with `coerceTypes: false`, `useDefaults: false`, `removeAdditional: false`: responses are validated,
  never "fixed".
- Unknown options are rejected, not ignored.
- A contract instance is immutable and stateless; share it across tests and run validations concurrently.

## Results and errors

```ts
interface ContractValidationResult {
  valid: boolean;
  operation?: { method: string; path: string; operationId?: string };
  errors: ContractIssue[]; // code, message, method, pathTemplate, actualPath, status, header, mediaType,
  warnings: ContractIssue[]; // instancePath, schemaPath, keyword, expected, actual (opt-in), operationId
  durationMs?: number;
}
```

Codes: `request.invalid_url`, `operation.not_found`, `operation.ambiguous`, `response.status_not_documented`,
`response.content_type_missing`, `response.content_type_unexpected`, `response.body_missing`,
`response.body_unexpected`, `response.body_too_large`, `response.body.invalid_json`,
`response.body.schema_invalid`, `response.body_validation_unsupported`, `response.header_missing`,
`response.header_invalid`, `spec.invalid`, `spec.unsupported_feature`, `spec.path_collision`,
`reference.not_allowed`, `reference.not_found`, `schema.compile_failed`. Order is deterministic.

- Violations of the contract are **returned**, not thrown. `assertResponse` throws `OpenApiContractAssertionError`
  (`.result` holds the structure).
- Problems with the contract itself (load, parse, compile) throw `OpenApiSpecError` (`.issues`).
  Bad options throw `OpenApiConfigError`; a malformed exchange throws `OpenApiInputError`; adapters throw
  `OpenApiAdapterError`.
- `formatValidationResult(result, { format: 'text' | 'json' })` renders a result for humans or tools.

## FAQ and troubleshooting

See [docs/troubleshooting.md](docs/troubleshooting.md). Common ones:

- **`operation.not_found` but the path looks right.** The contract's `servers` decide the prefix. Add the prefix to
  `servers` or pass `routing.basePath`; the error message hints when the path matches after removing a prefix.
- **`response.content_type_missing` with Supertest.** Pass real headers (`response.headers`); do not build the
  exchange from `body` alone.
- **Supertest throws on invalid JSON.** Superagent parses JSON itself. Use `.buffer(true).parse(textParser)` to see
  it as `response.body.invalid_json` (docs/express.md).
- **`nullable` in an OpenAPI 3.1 document fails to load.** `nullable` is not a 3.1 keyword (`type: [string, 'null']`
  is). The package refuses to pretend it works.

## Compared with related tools

Choose by the problem you have; these tools overlap only partly.

- **jest-openapi, vitest-openapi and forks**: matchers for one test runner. This package keeps the engine runner-
  independent, adds adapters, covers headers/Content-Type and OpenAPI 3.0-3.2 dialects, and offers matchers as a
  thin layer. Check their current maintenance and version support for your needs.
- **express-openapi-validator**: validates requests/responses inside the running app (middleware). This package is
  for assertions in test suites and CI, not for production traffic.
- **Schemathesis**: generates and runs tests from a contract. Complementary; this package checks the responses of
  tests you already have.
- **Pact**: consumer-driven contracts. A different problem; this checks a provider against its OpenAPI document.
- **Spectral / Redocly**: lint the OpenAPI file. Complementary.

## Development

```bash
npm install
npm run check        # format, lint, typecheck, unit/integration tests, build, dist + type + Jest tests
npm run test:pack    # npm pack, install the tarball in independent projects (needs network)
npm run bench        # 1000 operations, 10,000 validations (see benchmarks/)
```

## License

MIT. Bundled third-party material is listed in [NOTICE](NOTICE).
