import { describe, expect, it } from 'vitest';
import { codes, contractFor, json, response } from '../../helpers/exchanges.js';

const userSchema = {
  type: 'object',
  required: ['id', 'email'],
  properties: {
    id: { type: 'string' },
    email: { type: 'string', format: 'email' },
    nickname: { type: ['string', 'null'] },
  },
  additionalProperties: false,
};
const jsonResponse = (extra: Record<string, unknown> = {}) => ({
  '200': { description: 'ok', content: { 'application/json': { schema: userSchema } }, ...extra },
});

describe('Content-Type', () => {
  it('reports a missing Content-Type when there is a body', async () => {
    const contract = await contractFor(jsonResponse());
    const result = contract.validateResponse(response(200, { body: { id: '1', email: 'a@b.co' } }));
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: 'response.content_type_missing',
        expected: { mediaTypes: ['application/json'] },
      }),
    ]);
  });

  it('reports an unexpected Content-Type and does not validate the body against another type', async () => {
    const contract = await contractFor(jsonResponse());
    const result = contract.validateResponse(
      response(200, { headers: { 'content-type': 'text/html' }, body: '<html>' }),
    );
    expect(codes(result)).toEqual(['response.content_type_unexpected']);
    expect(result.errors[0]).toMatchObject({
      mediaType: 'text/html',
      expected: { mediaTypes: ['application/json'] },
    });
  });

  it('ignores parameters such as charset', async () => {
    const contract = await contractFor(jsonResponse());
    const body = { id: '1', email: 'a@b.co' };
    for (const ct of [
      'application/json; charset=utf-8',
      'Application/JSON;charset=UTF-8',
      'application/json ; charset="utf-8"',
    ]) {
      expect(
        contract.validateResponse(response(200, { headers: { 'Content-Type': ct }, body })).valid,
        ct,
      ).toBe(true);
    }
  });

  it('does not treat +json types as application/json unless the contract lists them', async () => {
    const strict = await contractFor(jsonResponse());
    const problem = response(200, {
      headers: { 'content-type': 'application/problem+json' },
      body: { id: '1', email: 'a@b.co' },
    });
    expect(codes(strict.validateResponse(problem))).toEqual(['response.content_type_unexpected']);

    const explicit = await contractFor({
      '400': {
        description: 'err',
        content: {
          'application/problem+json': { schema: { type: 'object', required: ['title'] } },
        },
      },
    });
    const ok = response(400, {
      headers: { 'content-type': 'application/problem+json' },
      body: { title: 'x' },
    });
    expect(explicit.validateResponse(ok).valid).toBe(true);
    expect(
      codes(
        explicit.validateResponse(
          response(400, { headers: { 'content-type': 'application/json' }, body: { title: 'x' } }),
        ),
      ),
    ).toEqual(['response.content_type_unexpected']);
    expect(
      codes(
        explicit.validateResponse(
          response(400, { headers: { 'content-type': 'application/problem+json' }, body: {} }),
        ),
      ),
    ).toEqual(['response.body.schema_invalid']);
  });

  it('prefers exact over type/* over */* and uses the schema of the selected entry', async () => {
    const contract = await contractFor({
      '200': {
        description: 'ok',
        content: {
          '*/*': { schema: { type: 'object', required: ['any'] } },
          'application/*': { schema: { type: 'object', required: ['app'] } },
          'application/json': { schema: { type: 'object', required: ['exact'] } },
        },
      },
    });
    const at = (contentType: string, body: unknown) =>
      contract.validateResponse(response(200, { headers: { 'content-type': contentType }, body }))
        .valid;
    expect(at('application/json', { exact: 1 })).toBe(true);
    expect(at('application/json', { app: 1 })).toBe(false);
    expect(at('application/problem+json', { app: 1 })).toBe(true);
    expect(at('application/xml', { app: 1 })).toBe(true);
    // image/png falls to */*, but binary content is never parsed as JSON: it is a warning, not a schema check
    expect(at('image/png', { any: 1 })).toBe(true);
  });

  it('rejects malformed or repeated Content-Type headers', async () => {
    const contract = await contractFor(jsonResponse());
    const body = { id: '1', email: 'a@b.co' };
    expect(
      codes(
        contract.validateResponse(response(200, { headers: { 'content-type': 'json' }, body })),
      ),
    ).toEqual(['response.content_type_unexpected']);
    expect(
      codes(
        contract.validateResponse(
          response(200, {
            headers: [
              ['content-type', 'application/json'],
              ['content-type', 'application/json'],
            ],
            body,
          }),
        ),
      ),
    ).toEqual(['response.content_type_unexpected']);
  });
});

describe('JSON body validation', () => {
  it('accepts a valid body and reports each schema violation with its JSON path', async () => {
    const contract = await contractFor(jsonResponse());
    expect(
      contract.validateResponse(
        response(200, { headers: json, body: { id: '1', email: 'a@b.co', nickname: null } }),
      ).valid,
    ).toBe(true);

    const result = contract.validateResponse(
      response(200, { headers: json, body: { id: 1, email: 'not-an-email', extra: true } }),
    );
    expect(result.errors.map((e) => [e.instancePath, e.keyword])).toEqual([
      ['', 'additionalProperties'],
      ['/email', 'format'],
      ['/id', 'type'],
    ]);
    expect(
      result.errors.every(
        (e) => e.code === 'response.body.schema_invalid' && e.mediaType === 'application/json',
      ),
    ).toBe(true);
    expect(result.errors.find((e) => e.instancePath === '/id')).toMatchObject({
      message: 'must be string (received integer)',
      schemaPath: '/components/schemas/Subject/properties/id/type'.replace(
        '/components/schemas/Subject',
        '/paths/~1thing/get/responses/200/content/application~1json/schema',
      ),
    });
  });

  it('parses rawBody from strings and bytes, and reports invalid JSON without echoing the payload', async () => {
    const contract = await contractFor(jsonResponse());
    const raw = JSON.stringify({ id: '1', email: 'a@b.co' });
    expect(contract.validateResponse(response(200, { headers: json, rawBody: raw })).valid).toBe(
      true,
    );
    expect(
      contract.validateResponse(
        response(200, { headers: json, rawBody: new TextEncoder().encode(raw) }),
      ).valid,
    ).toBe(true);
    expect(
      contract.validateResponse(
        response(200, { headers: json, rawBody: String.fromCharCode(0xfeff) + raw }),
      ).valid,
    ).toBe(true);

    const bad = contract.validateResponse(
      response(200, { headers: json, rawBody: '{"id": "secret-password-123", ' }),
    );
    expect(codes(bad)).toEqual(['response.body.invalid_json']);
    expect(JSON.stringify(bad)).not.toContain('secret-password-123');
    expect(
      codes(
        contract.validateResponse(
          response(200, { headers: json, rawBody: new Uint8Array([0xff, 0xfe, 0x7b]) }),
        ),
      ),
    ).toEqual(['response.body.invalid_json']);
  });

  it('does not parse an already parsed body again: a JSON string value stays a string', async () => {
    const contract = await contractFor({
      '200': { description: 'ok', content: { 'application/json': { schema: { type: 'string' } } } },
    });
    expect(contract.validateResponse(response(200, { headers: json, body: 'hello' })).valid).toBe(
      true,
    );
    expect(contract.validateResponse(response(200, { headers: json, body: '{"a":1}' })).valid).toBe(
      true,
    ); // a string whose text looks like JSON
    expect(
      contract.validateResponse(response(200, { headers: json, rawBody: '"hello"' })).valid,
    ).toBe(true);
    expect(
      codes(contract.validateResponse(response(200, { headers: json, rawBody: 'hello' }))),
    ).toEqual(['response.body.invalid_json']);
  });

  it('handles primitives, arrays and JSON null as bodies', async () => {
    const arr = await contractFor({
      '200': {
        description: 'ok',
        content: { 'application/json': { schema: { type: 'array', items: { type: 'integer' } } } },
      },
    });
    expect(arr.validateResponse(response(200, { headers: json, body: [1, 2] })).valid).toBe(true);
    expect(codes(arr.validateResponse(response(200, { headers: json, body: [1, 'x'] })))).toEqual([
      'response.body.schema_invalid',
    ]);
    const num = await contractFor({
      '200': { description: 'ok', content: { 'application/json': { schema: { type: 'number' } } } },
    });
    expect(num.validateResponse(response(200, { headers: json, body: 0 })).valid).toBe(true);
    expect(num.validateResponse(response(200, { headers: json, body: false })).valid).toBe(false);
  });

  it('keeps JSON null, empty and absent bodies apart', async () => {
    const nullable = await contractFor({
      '200': { description: 'ok', content: { 'application/json': { schema: { type: 'null' } } } },
    });
    expect(nullable.validateResponse(response(200, { headers: json, body: null })).valid).toBe(
      true,
    );
    expect(nullable.validateResponse(response(200, { headers: json, rawBody: 'null' })).valid).toBe(
      true,
    );
    expect(codes(nullable.validateResponse(response(200, { headers: json, rawBody: '' })))).toEqual(
      ['response.body_missing'],
    );
    expect(codes(nullable.validateResponse(response(200, { headers: json })))).toEqual([
      'response.body_missing',
    ]);

    const objectContract = await contractFor(jsonResponse());
    const nullBody = objectContract.validateResponse(response(200, { headers: json, body: null }));
    expect(codes(nullBody)).toEqual(['response.body.schema_invalid']);
    expect(nullBody.errors[0]?.message).toBe('must be object (received null)');
  });

  it('treats bodyPresent:false as no payload even if the client reports a parsed {} (Supertest)', async () => {
    const contract = await contractFor(jsonResponse());
    expect(
      codes(
        contract.validateResponse(response(200, { headers: json, body: {}, bodyPresent: false })),
      ),
    ).toEqual(['response.body_missing']);
    const noContent = await contractFor({ '200': { description: 'ok' } });
    expect(noContent.validateResponse(response(200, { body: {}, bodyPresent: false })).valid).toBe(
      true,
    );
  });

  it('warns when a body is announced but not provided', async () => {
    const contract = await contractFor(jsonResponse());
    const result = contract.validateResponse(response(200, { headers: json, bodyPresent: true }));
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual(['response.body_validation_unsupported']);
  });

  it('reports a body the contract does not define', async () => {
    const contract = await contractFor({ '200': { description: 'ok' } });
    expect(
      codes(contract.validateResponse(response(200, { headers: json, body: { a: 1 } }))),
    ).toEqual(['response.body_unexpected']);
    expect(codes(contract.validateResponse(response(200, { rawBody: 'text' })))).toEqual([
      'response.body_unexpected',
    ]);
    expect(codes(contract.validateResponse(response(200, { headers: json, body: null })))).toEqual([
      'response.body_unexpected',
    ]);
    expect(contract.validateResponse(response(200, { rawBody: '' })).valid).toBe(true);
    expect(contract.validateResponse(response(200)).valid).toBe(true);
  });

  it('does not require a schema: content without schema accepts any JSON', async () => {
    const contract = await contractFor({
      '200': { description: 'ok', content: { 'application/json': {} } },
    });
    expect(
      contract.validateResponse(response(200, { headers: json, body: { anything: [1] } })).valid,
    ).toBe(true);
    expect(
      codes(contract.validateResponse(response(200, { headers: json, rawBody: '{oops' }))),
    ).toEqual(['response.body.invalid_json']);
  });

  it('enforces maxBodyBytes for raw payloads without parsing them', async () => {
    const contract = await contractFor(jsonResponse(), {
      options: { validation: { maxBodyBytes: 20 } },
    });
    const big = JSON.stringify({ id: 'x'.repeat(100), email: 'a@b.co' });
    const result = contract.validateResponse(response(200, { headers: json, rawBody: big }));
    expect(codes(result)).toEqual(['response.body_too_large']);
    const small = JSON.stringify({ id: '1' });
    expect(
      codes(contract.validateResponse(response(200, { headers: json, rawBody: small }))),
    ).toEqual(['response.body.schema_invalid']);
  });

  it('caps the number of reported errors and says so', async () => {
    const contract = await contractFor(
      {
        '200': {
          description: 'ok',
          content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } },
        },
      },
      { options: { validation: { maxErrors: 3 } } },
    );
    const result = contract.validateResponse(
      response(200, { headers: json, body: [1, 2, 3, 4, 5, 6] }),
    );
    expect(result.errors).toHaveLength(3);
    expect(result.warnings[0]?.message).toMatch(/3 more error\(s\) were omitted/);
  });

  it('does not mutate the exchange', async () => {
    const contract = await contractFor(jsonResponse());
    const exchange = response(200, {
      headers: { 'Content-Type': 'application/json' },
      body: { id: 1, email: 'x', nested: { a: [1] } },
    });
    const snapshot = structuredClone(exchange);
    contract.validateResponse(exchange);
    expect(exchange).toEqual(snapshot);
  });

  it('only prints values when asked, truncated', async () => {
    const quiet = await contractFor(jsonResponse());
    const loud = await contractFor(jsonResponse(), {
      options: { validation: { includeActualValues: true } },
    });
    const exchange = response(200, {
      headers: json,
      body: { id: 'x'.repeat(500), email: 'password-hunter2' },
    });
    expect(JSON.stringify(quiet.validateResponse(exchange))).not.toContain('hunter2');
    const shown = loud.validateResponse(exchange).errors.find((e) => e.instancePath === '/email');
    expect(shown?.actual).toBe('password-hunter2');
  });
});

describe('text and unsupported bodies', () => {
  it('validates text/plain against string schemas and scalar-typed text', async () => {
    const contract = await contractFor({
      '200': {
        description: 'ok',
        content: { 'text/plain': { schema: { type: 'string', minLength: 3 } } },
      },
      '201': {
        description: 'n',
        content: { 'text/plain': { schema: { type: 'integer', minimum: 0 } } },
      },
    });
    const text = { 'content-type': 'text/plain; charset=utf-8' };
    expect(
      contract.validateResponse(response(200, { headers: text, rawBody: 'hello' })).valid,
    ).toBe(true);
    expect(
      codes(contract.validateResponse(response(200, { headers: text, rawBody: 'hi' }))),
    ).toEqual(['response.body.schema_invalid']);
    expect(contract.validateResponse(response(201, { headers: text, rawBody: '42' })).valid).toBe(
      true,
    );
    expect(
      codes(contract.validateResponse(response(201, { headers: text, rawBody: 'forty-two' }))),
    ).toEqual(['response.body.schema_invalid']);
    expect(
      codes(contract.validateResponse(response(201, { headers: text, rawBody: '-1' }))),
    ).toEqual(['response.body.schema_invalid']);
    expect(contract.validateResponse(response(200, { headers: text, body: 'hello' })).valid).toBe(
      true,
    );
  });

  it('treats an empty text/plain payload as an empty string, other empty bodies as missing', async () => {
    const contract = await contractFor({
      '200': { description: 'ok', content: { 'text/plain': { schema: { type: 'string' } } } },
    });
    const text = { 'content-type': 'text/plain' };
    expect(contract.validateResponse(response(200, { headers: text, rawBody: '' })).valid).toBe(
      true,
    );
    expect(codes(contract.validateResponse(response(200, { headers: text })))).toEqual([
      'response.body_missing',
    ]);
    const strict = await contractFor({
      '200': {
        description: 'ok',
        content: { 'text/plain': { schema: { type: 'string', minLength: 1 } } },
      },
    });
    expect(codes(strict.validateResponse(response(200, { headers: text, rawBody: '' })))).toEqual([
      'response.body.schema_invalid',
    ]);
  });

  it('never validates XML, HTML, binary or multipart as JSON; it warns instead of silently passing', async () => {
    const contract = await contractFor({
      '200': {
        description: 'ok',
        content: {
          'application/xml': { schema: { type: 'object' } },
          'image/png': { schema: { type: 'string', format: 'binary' } },
          'multipart/mixed': {},
        },
      },
    });
    for (const [ct, rawBody] of [
      ['application/xml', '<a/>'],
      ['image/png', new Uint8Array([1, 2, 3])],
      ['multipart/mixed; boundary=x', '--x--'],
    ] as const) {
      const result = contract.validateResponse(
        response(200, { headers: { 'content-type': ct }, rawBody }),
      );
      expect(result.valid, ct).toBe(true);
      expect(
        result.warnings.map((w) => w.code),
        ct,
      ).toEqual(['response.body_validation_unsupported']);
    }
    // ...but Content-Type and presence are still enforced
    expect(
      codes(
        contract.validateResponse(
          response(200, { headers: { 'content-type': 'application/pdf' }, rawBody: 'x' }),
        ),
      ),
    ).toEqual(['response.content_type_unexpected']);
    expect(
      codes(contract.validateResponse(response(200, { headers: { 'content-type': 'image/png' } }))),
    ).toEqual(['response.body_missing']);
  });
});

describe('HEAD, 1xx, 204 and 304', () => {
  const contract = () =>
    contractFor(
      {
        '200': { description: 'ok', content: { 'application/json': { schema: userSchema } } },
        '204': { description: 'none' },
        '304': { description: 'not modified' },
        '100': { description: 'continue' },
        '205': { description: 'reset' },
      },
      { method: 'get' },
    );

  it.each([204, 304, 100, 205])('accepts %i without a body and flags a body', async (status) => {
    const c = await contract();
    expect(c.validateResponse(response(status)).valid).toBe(true);
    expect(c.validateResponse(response(status, { bodyPresent: false, body: {} })).valid).toBe(true);
    expect(codes(c.validateResponse(response(status, { rawBody: 'oops' })))).toEqual([
      'response.body_unexpected',
    ]);
  });

  it('does not demand a body or Content-Type for 204/304 even if the contract was sloppy', async () => {
    const c = await contractFor({
      '204': { description: 'x', content: { 'application/json': { schema: { type: 'object' } } } },
    });
    expect(c.validateResponse(response(204)).valid).toBe(true);
  });

  it('HEAD: no body is required and none is allowed; headers are still checked', async () => {
    const c = await contractFor(
      {
        '200': {
          description: 'ok',
          headers: { 'X-Total': { required: true, schema: { type: 'integer' } } },
          content: { 'application/json': { schema: userSchema } },
        },
      },
      { method: 'head' },
    );
    const head = (extra: Parameters<typeof response>[1]) =>
      response(200, extra, { method: 'HEAD' });
    expect(
      c.validateResponse(head({ headers: { 'x-total': '3', 'content-type': 'application/json' } }))
        .valid,
    ).toBe(true);
    expect(c.validateResponse(head({ headers: { 'x-total': '3' } })).valid).toBe(true);
    expect(codes(c.validateResponse(head({ headers: { 'x-total': 'many' } })))).toEqual([
      'response.header_invalid',
    ]);
    expect(codes(c.validateResponse(head({ headers: { 'x-total': '3' }, rawBody: '{}' })))).toEqual(
      ['response.body_unexpected'],
    );
    expect(
      codes(c.validateResponse(head({ headers: { 'x-total': '3', 'content-type': 'text/html' } }))),
    ).toEqual(['response.content_type_unexpected']);
  });
});

describe('combined failures', () => {
  it('reports status-independent problems as separate, ordered diagnostics', async () => {
    const contract = await contractFor({
      '200': {
        description: 'ok',
        headers: { 'X-Request-Id': { required: true, schema: { type: 'string' } } },
        content: { 'application/json': { schema: userSchema } },
      },
    });
    const result = contract.validateResponse(
      response(200, { headers: json, body: { id: 5, email: 'a@b.co' } }),
    );
    expect(result.errors.map((e) => e.code)).toEqual([
      'response.header_missing',
      'response.body.schema_invalid',
    ]);

    const wrongType = contract.validateResponse(
      response(200, { headers: { 'content-type': 'text/plain' }, body: 'x' }),
    );
    expect(wrongType.errors.map((e) => e.code)).toEqual([
      'response.header_missing',
      'response.content_type_unexpected',
    ]);

    const wrongStatus = contract.validateResponse(response(418));
    expect(wrongStatus.errors.map((e) => e.code)).toEqual(['response.status_not_documented']);
  });

  it('is deterministic across runs', async () => {
    const contract = await contractFor(jsonResponse());
    const exchange = response(200, {
      headers: json,
      body: { id: 1, email: 5, extra: 1, other: 2 },
    });
    const strip = (r: ReturnType<typeof contract.validateResponse>) => ({ ...r, durationMs: 0 });
    expect(strip(contract.validateResponse(exchange))).toEqual(
      strip(contract.validateResponse(exchange)),
    );
  });
});
