import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadOpenApiContract } from '../../../src/index.js';
import { fromFetch } from '../../../src/adapters/fetch.js';
import { fromSupertest } from '../../../src/adapters/supertest.js';
import { textParser } from '../../helpers/text-parser.js';
import { USER, defineReferenceSuite, referenceSpec } from '../../helpers/reference-suite.js';
import type { Fault } from '../../helpers/reference-suite.js';

function createApp() {
  const app = express();
  const api = express.Router();
  api.get('/users/:id', (req, res) => {
    const fault = req.query['fault'] as Fault | undefined;
    if (fault === 'not-found') return res.status(404).json({ message: 'No such user' });
    if (fault === 'status') return res.status(500).json({ message: 'boom' });
    if (fault === 'content-type')
      return res.status(200).set('X-Request-Id', 'r-1').type('text/plain').send('hello');
    if (fault === 'json')
      return res
        .status(200)
        .set('X-Request-Id', 'r-1')
        .type('application/json')
        .send('{"id": "1", ');
    if (fault !== 'header' && fault !== 'multi') res.set('X-Request-Id', 'r-1');
    return res.json(
      fault === 'property' || fault === 'multi'
        ? { ...USER, email: 42 }
        : { ...USER, id: req.params['id'] },
    );
  });
  api.delete('/users/:id', (_req, res) => res.status(204).end());
  api.get('/health', (_req, res) => res.type('text/plain').send('ok'));
  app.use('/api/v1', api);
  return app;
}

describe('Express + Supertest', () => {
  const app = createApp();
  defineReferenceSuite('Express + Supertest', async (fault) => {
    const url = `/api/v1/users/123${fault ? `?fault=${fault}` : ''}`;
    // A text parser lets invalid JSON through instead of making Superagent throw (see fromSupertest docs).
    const res = await request(app).get(url).buffer(true).parse(textParser);
    return fromSupertest(res, { method: 'GET', url });
  });

  it('works with the example from the documentation (manual exchange)', async () => {
    const contract = await loadOpenApiContract({ source: referenceSpec });
    const response = await request(app).get('/api/v1/users/123');
    const result = contract.validateResponse({
      request: { method: 'GET', url: '/api/v1/users/123' },
      response: {
        status: response.status,
        headers: response.headers,
        body: response.body,
        bodyPresent: response.text.length > 0,
      },
    });
    expect(result.valid).toBe(true);
  });

  it('handles 204 (DELETE) and text/plain (GET /health) responses', async () => {
    const contract = await loadOpenApiContract({ source: referenceSpec });
    const del = await request(app).delete('/api/v1/users/1');
    expect(
      contract.validateResponse(fromSupertest(del, { method: 'DELETE', url: '/api/v1/users/1' }))
        .errors,
    ).toEqual([]);
    const health = await request(app).get('/api/v1/health');
    expect(
      contract.validateResponse(fromSupertest(health, { method: 'GET', url: '/api/v1/health' }))
        .errors,
    ).toEqual([]);
  });

  it('flags a 204 that carries a body', async () => {
    const contract = await loadOpenApiContract({ source: referenceSpec });
    const result = contract.validateResponse({
      request: { method: 'DELETE', url: '/api/v1/users/1' },
      response: { status: 204, rawBody: 'x' },
    });
    expect(result.errors.map((e) => e.code)).toEqual(['response.body_unexpected']);
  });
});

describe('Express + Fetch (real socket)', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    server = await new Promise<Server>((resolve) => {
      const s = createApp().listen(0, '127.0.0.1', () => {
        resolve(s);
      });
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
  });

  defineReferenceSuite('Express + Fetch', async (fault) => {
    const url = `${base}/api/v1/users/123${fault ? `?fault=${fault}` : ''}`;
    const res = await fetch(url);
    return fromFetch({ method: 'GET', url }, res);
  });

  it('leaves the original response body readable', async () => {
    const res = await fetch(`${base}/api/v1/users/123`);
    const exchange = await fromFetch(new Request(`${base}/api/v1/users/123`), res);
    expect(exchange.request.method).toBe('GET');
    expect(await res.json()).toMatchObject({ id: '123' });
  });

  it('refuses a response whose body was already consumed', async () => {
    const res = await fetch(`${base}/api/v1/users/123`);
    await res.text();
    await expect(
      fromFetch({ method: 'GET', url: `${base}/api/v1/users/123` }, res),
    ).rejects.toThrow(/cannot be cloned/);
  });

  it('does not buffer more than maxBodyBytes', async () => {
    const res = new Response('x'.repeat(10_000), {
      headers: { 'content-type': 'application/json' },
    });
    const exchange = await fromFetch({ method: 'GET', url: '/x' }, res, { maxBodyBytes: 100 });
    expect((exchange.response.rawBody as Uint8Array).byteLength).toBe(101);
  });

  it('adapts a body-less response', async () => {
    const res = await fetch(`${base}/api/v1/users/1`, { method: 'DELETE' });
    const exchange = await fromFetch({ method: 'DELETE', url: `${base}/api/v1/users/1` }, res);
    expect(exchange.response).toMatchObject({ status: 204, bodyPresent: false });
    expect(exchange.response.rawBody).toBeUndefined();
  });
});
