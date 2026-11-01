# Jest

Tested with Jest 30, running the CommonJS build of this package (`tests/integration/jest`).

## Setup

```js
// jest.config.js
module.exports = { setupFilesAfterEnv: ['openapi-contract-testing/jest'] };
```

Importing `openapi-contract-testing/jest` registers `toConformToOpenApi` on the global `expect`.

### TypeScript

TypeScript only knows the matcher's type in files that can see an import of `openapi-contract-testing/jest`. Naming
the package in `setupFilesAfterEnv` does not give your test files that type, so use a small setup file instead:

```ts
// test/setup.ts
import 'openapi-contract-testing/jest';
```

```js
// jest.config.js
module.exports = { preset: 'ts-jest', setupFilesAfterEnv: ['<rootDir>/test/setup.ts'] };
```

Make sure `tsconfig.json` includes `test/setup.ts` (for example `"include": ["src", "test"]`); otherwise ts-jest
reports `Property 'toConformToOpenApi' does not exist`. This works with `moduleResolution` `node10` (the default for
NestJS CommonJS projects), `node16`, `nodenext` and `bundler`.

Manual testing with NestJS 11, Jest 30 and ts-jest worked. NestJS 12 and `@nestjs/swagger` 12 are published as ESM-only
and did not load under Jest's default CommonJS mode in that test; that comes from Nest and Jest, not from this package.

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
