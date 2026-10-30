import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import axios from 'axios';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpenApiAdapterError, loadOpenApiContract } from '../../../src/index.js';
import { fromAxios } from '../../../src/adapters/axios.js';
import { USER, defineReferenceSuite, referenceSpec } from '../../helpers/reference-suite.js';
import type { Fault } from '../../helpers/reference-suite.js';

function createApp() {
  const app = express();
  app.get('/api/v1/users/:id', (req, res) => {
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
  app.delete('/api/v1/users/:id', (_req, res) => res.status(204).end());
  return app;
}

describe('Axios', () => {
  let server: Server;
  let client: ReturnType<typeof axios.create>;
  beforeAll(async () => {
    server = await new Promise<Server>((resolve) => {
      const s = createApp().listen(0, '127.0.0.1', () => {
        resolve(s);
      });
    });
    client = axios.create({
      baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`,
      validateStatus: () => true,
    });
  });
  afterAll(() => {
    server.close();
  });

  // arraybuffer gives the adapter the exact payload, so even invalid JSON is observed (Axios would hide it).
  defineReferenceSuite('Axios (arraybuffer)', async (fault) => {
    const res = await client.get(`/users/123${fault ? `?fault=${fault}` : ''}`, {
      responseType: 'arraybuffer',
    });
    return fromAxios(res);
  });

  it('combines baseURL and url and works with the default parsed JSON mode', async () => {
    const contract = await loadOpenApiContract({ source: referenceSpec });
    const res = await client.get('/users/123');
    const exchange = fromAxios(res);
    expect(exchange.request).toEqual({
      method: 'get',
      url: `${client.defaults.baseURL}/users/123`,
    });
    expect(contract.validateResponse(exchange).errors).toEqual([]);
    expect(
      contract
        .validateResponse(fromAxios(await client.get('/users/123?fault=property')))
        .errors.map((e) => e.code),
    ).toEqual(['response.body.schema_invalid']);
  });

  it('treats an empty body as absent and accepts request overrides', async () => {
    const contract = await loadOpenApiContract({ source: referenceSpec });
    const res = await client.delete('/users/1');
    const exchange = fromAxios(res, { url: '/api/v1/users/1' });
    expect(exchange.response.bodyPresent).toBe(false);
    expect(exchange.request).toEqual({ method: 'delete', url: '/api/v1/users/1' });
    expect(contract.validateResponse(exchange).errors).toEqual([]);
  });

  it('supports responseType "text" and normalizes header objects', async () => {
    const res = await client.get('/users/123', { responseType: 'text' });
    const exchange = fromAxios(res);
    expect(typeof exchange.response.rawBody).toBe('string');
    expect(exchange.response.headers).toMatchObject({ 'x-request-id': 'r-1' });
  });

  it('refuses stream/blob/document response types and responses without a request', async () => {
    const res = await client.get('/users/123', { responseType: 'stream' });
    expect(() => fromAxios(res)).toThrow(OpenApiAdapterError);
    (res.data as { destroy(): void }).destroy();
    expect(() => fromAxios({ status: 200, headers: {}, data: '' })).toThrow(
      /pass \{ method, url \}/,
    );
  });
});
