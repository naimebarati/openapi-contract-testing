const document = {
  openapi: '3.1.0',
  info: { title: 'Matcher', version: '1' },
  paths: {
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        responses: {
          200: {
            description: 'ok',
            headers: { 'X-Request-Id': { required: true, schema: { type: 'string' } } },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id'],
                  properties: { id: { type: 'integer' } },
                },
              },
            },
          },
        },
      },
    },
  },
};

const exchange = (body, headers) => ({
  request: { method: 'GET', url: '/users/1' },
  response: { status: 200, headers, body },
});

module.exports = {
  document,
  good: exchange({ id: 1 }, { 'content-type': 'application/json', 'x-request-id': 'r' }),
  bad: exchange({ id: 'one' }, { 'content-type': 'application/json' }),
};
