import { expect } from 'vitest';
import type { OpenApiContract } from './public-types.js';
import { matchers, toConformToOpenApi } from './matchers/shared.js';

export { matchers, toConformToOpenApi };

expect.extend(matchers);

declare module 'vitest' {
  // The declaration must repeat Vitest's own type parameters to merge with its `Matchers` interface.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    /** Asserts that an HTTP exchange conforms to an OpenAPI contract. */
    toConformToOpenApi(contract: OpenApiContract): R;
  }
}
