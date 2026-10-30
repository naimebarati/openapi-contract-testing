// Default Jest setup: importing the subpath registers the matcher on the global `expect`.
require('../../../dist/jest.cjs');
const { loadOpenApiContract } = require('../../../dist/index.cjs');
const { document, good, bad } = require('./shared.cjs');

describe('Jest matcher toConformToOpenApi (CommonJS build)', () => {
  let contract;
  beforeAll(async () => {
    contract = await loadOpenApiContract({ document });
  });

  test('passes for a conforming exchange', () => {
    expect(good).toConformToOpenApi(contract);
  });

  test('fails with the formatted result', () => {
    let message = '';
    try {
      expect(bad).toConformToOpenApi(contract);
    } catch (error) {
      message = error.message;
    }
    expect(message).toContain('OpenAPI response contract failed');
    expect(message).toContain('1. response.header_missing');
    expect(message).toContain('Header: X-Request-Id');
    expect(message).toContain('2. response.body.schema_invalid');
    expect(message).toContain('Path: $.id');
  });

  test('supports .not', () => {
    expect(bad).not.toConformToOpenApi(contract);
    expect(() => expect(good).not.toConformToOpenApi(contract)).toThrow(
      /not to conform.*conforms to GET \/users\/\{id\}/,
    );
  });

  test('supports .resolves', async () => {
    await expect(Promise.resolve(good)).resolves.toConformToOpenApi(contract);
    await expect(Promise.resolve(bad)).resolves.not.toConformToOpenApi(contract);
  });

  test('rejects misuse with a helpful message', () => {
    expect(() => expect(good).toConformToOpenApi()).toThrow(/expects an OpenApiContract/);
  });
});
