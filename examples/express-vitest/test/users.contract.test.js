import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadOpenApiContract } from 'openapi-contract-testing';
import { fromSupertest } from 'openapi-contract-testing/adapters/supertest';
import 'openapi-contract-testing/vitest';
import { createApp } from '../src/app.js';

describe('Users API follows openapi.yaml', () => {
  const app = createApp();
  let contract;

  beforeAll(async () => {
    // Loaded once: the document is validated and every schema is compiled here.
    contract = await loadOpenApiContract({ source: new URL('../openapi.yaml', import.meta.url) });
  });

  it('GET /api/v1/users/:id', async () => {
    const url = '/api/v1/users/123';
    const response = await request(app).get(url);
    expect(fromSupertest(response, { method: 'GET', url })).toConformToOpenApi(contract);
  });

  it('GET /api/v1/users/404 (documented error response)', async () => {
    const url = '/api/v1/users/404';
    const response = await request(app).get(url);
    contract.assertResponse(fromSupertest(response, { method: 'GET', url }));
  });
});
