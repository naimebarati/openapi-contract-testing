# Vitest

Tested with Vitest 5 (`vitest` is an optional peer dependency, `^5.0.0`).

## Setup

```ts
// vitest.config.ts
export default defineConfig({ test: { setupFiles: ['openapi-contract-testing/vitest'] } });
```

Or import it in a test file: `import 'openapi-contract-testing/vitest';`. If you use explicit registration:

```ts
import { expect } from 'vitest';
import { matchers } from 'openapi-contract-testing/vitest';
expect.extend(matchers);
```

## Use

```ts
expect(exchange).toConformToOpenApi(contract);
expect(brokenExchange).not.toConformToOpenApi(contract);
await expect(fetchExchange()).resolves.toConformToOpenApi(contract);
expect({ exchange }).toEqual({ exchange: expect.toConformToOpenApi(contract) });
```

The types augment Vitest's `Matchers` interface (the extension point of Vitest 5). Older Vitest majors declare
that interface differently and are not covered by the type augmentation or by this package's tests.
