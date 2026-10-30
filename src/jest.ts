// Needed so the `declare module 'expect'` augmentation below can resolve it under NodeNext.
import type {} from 'expect';
import type { OpenApiContract } from './public-types.js';
import { matchers, toConformToOpenApi } from './matchers/shared.js';

export { matchers, toConformToOpenApi };

interface ExpectLike {
  extend(matchers: Record<string, unknown>): void;
}

// With Jest's default `injectGlobals`, importing this module registers the matcher. With
// `injectGlobals: false` there is no global `expect`: call `expect.extend(matchers)` yourself.
const globalExpect = (globalThis as { expect?: ExpectLike }).expect;
if (globalExpect && typeof globalExpect.extend === 'function') {
  globalExpect.extend(matchers);
}

// Type augmentation for both `@types/jest` (global namespace) and `@jest/globals` / `expect`.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      /** Asserts that an HTTP exchange conforms to an OpenAPI contract. */
      toConformToOpenApi(contract: OpenApiContract): R;
    }
  }
}

declare module 'expect' {
  interface Matchers<R extends void | Promise<void>> {
    /** Asserts that an HTTP exchange conforms to an OpenAPI contract. */
    toConformToOpenApi(contract: OpenApiContract): R;
  }
}
