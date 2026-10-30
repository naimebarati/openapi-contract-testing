# Jest

Tested with Jest 30, running the CommonJS build of this package (`tests/integration/jest`).

## Setup

```js
// jest.config.js
module.exports = { setupFilesAfterEnv: ['openapi-contract-testing/jest'] };
```

Importing `openapi-contract-testing/jest` registers `toConformToOpenApi` on the global `expect`.

With `injectGlobals: false` (or when you prefer explicit imports):

```ts
import { expect } from '@jest/globals';
import { matchers } from 'openapi-contract-testing/jest';
expect.extend(matchers);
```

## Use

```ts
const contract = await loadOpenApiContract({ source: './openapi.yaml' });
const exchange = fromSupertest(await request(app).get(url), { method: 'GET', url });

expect(exchange).toConformToOpenApi(contract);
expect(brokenExchange).not.toConformToOpenApi(contract);
await expect(Promise.resolve(exchange)).resolves.toConformToOpenApi(contract);
```

A failing assertion prints the same report as `assertResponse`. `.not` passes only for responses that violate the
contract (including unknown operations and undocumented statuses); use it deliberately.

## Types

The subpath augments `jest.Matchers` (for `@types/jest`) and `expect`'s `Matchers` (for `@jest/globals`). The
second augmentation imports the `expect` package types, which ships with Jest; `expect` is declared as an optional
peer dependency. With `skipLibCheck: false` and a package manager that does not hoist it, install `expect`.

## ESM mode

Jest's native ESM mode (`--experimental-vm-modules`) is not covered by this package's tests.
