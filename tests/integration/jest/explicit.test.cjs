// `injectGlobals: false`: there is no global expect, so the matcher is registered explicitly.
const { expect, test, describe, beforeAll } = require('@jest/globals');
const { matchers } = require('../../../dist/jest.cjs');
const { loadOpenApiContract } = require('../../../dist/index.cjs');
const { document, good, bad } = require('./shared.cjs');

expect.extend(matchers);

describe('Jest matcher with explicit registration', () => {
  let contract;
  beforeAll(async () => {
    contract = await loadOpenApiContract({ document });
  });

  test('works with @jest/globals', () => {
    expect(typeof globalThis.expect).toBe('undefined');
    expect(good).toConformToOpenApi(contract);
    expect(bad).not.toConformToOpenApi(contract);
    expect(() => expect(bad).toConformToOpenApi(contract)).toThrow(/response.header_missing/);
  });
});
