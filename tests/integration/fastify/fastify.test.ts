import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadOpenApiContract } from '../../../src/index.js';
import { fromFastifyInject } from '../../../src/adapters/fastify.js';
import { USER, defineReferenceSuite, referenceSpec } from '../../helpers/reference-suite.js';
import type { Fault } from '../../helpers/reference-suite.js';

function createApp() {
  const app = Fastify();
  app.register(
    (api, _options, done) => {
      api.get<{ Params: { id: string }; Querystring: { fault?: Fault } }>(
        '/users/:id',
        async (req, reply) => {
          const fault = req.query.fault;
          if (fault === 'not-found') return reply.code(404).send({ message: 'No such user' });
          if (fault === 'status') return reply.code(500).send({ message: 'boom' });
          if (fault === 'content-type')
            return reply.code(200).header('x-request-id', 'r-1').type('text/plain').send('hello');
          if (fault === 'json')
            return reply
              .code(200)
              .header('x-request-id', 'r-1')
              .type('application/json')
              .send('{"id": "1", ');
          if (fault !== 'header' && fault !== 'multi') reply.header('x-request-id', 'r-1');
          return reply.send(
            fault === 'property' || fault === 'multi'
              ? { ...USER, email: 42 }
              : { ...USER, id: req.params.id },
          );
        },
      );
      api.delete('/users/:id', async (_req, reply) => reply.code(204).send());
      api.get('/health', async (_req, reply) => reply.type('text/plain').send('ok'));
      done();
    },
    { prefix: '/api/v1' },
  );
  return app;
}

describe('Fastify inject()', () => {
  const app = createApp();
  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  defineReferenceSuite('Fastify inject', async (fault) => {
    const url = `/api/v1/users/123${fault ? `?fault=${fault}` : ''}`;
    const res = await app.inject({ method: 'GET', url });
    return fromFastifyInject(res, { method: 'GET', url });
  });

  it('adapts bodies of text and empty responses', async () => {
    const contract = await loadOpenApiContract({ source: referenceSpec });
    const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(
      contract.validateResponse(fromFastifyInject(health, { method: 'GET', url: '/api/v1/health' }))
        .errors,
    ).toEqual([]);
    const del = await app.inject({ method: 'DELETE', url: '/api/v1/users/1' });
    const exchange = fromFastifyInject(del, { method: 'DELETE', url: '/api/v1/users/1' });
    expect(exchange.response.bodyPresent).toBe(false);
    expect(contract.validateResponse(exchange).errors).toEqual([]);
  });

  it('keeps repeated headers separate', async () => {
    const instance = Fastify();
    instance.get('/cookies', async (_req, reply) =>
      reply.header('set-cookie', ['a=1', 'b=2']).send('x'),
    );
    const res = await instance.inject({ method: 'GET', url: '/cookies' });
    const exchange = fromFastifyInject(res, { method: 'GET', url: '/cookies' });
    expect(exchange.response.headers).toMatchObject({ 'set-cookie': ['a=1', 'b=2'] });
    await instance.close();
  });
});
