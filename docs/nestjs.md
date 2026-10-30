# NestJS

The package does not depend on `@nestjs/common` or `@nestjs/swagger`. Use whichever source of the contract you
have.

## Contract generated from the application

```ts
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { loadOpenApiContract } from 'openapi-contract-testing';
import { fromSupertest } from 'openapi-contract-testing/adapters/supertest';

const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
const app = moduleRef.createNestApplication();
app.setGlobalPrefix('api/v1');
await app.init();

const document = SwaggerModule.createDocument(
  app,
  new DocumentBuilder().setTitle('API').setVersion('1').build(),
);
const contract = await loadOpenApiContract({
  document: document as unknown as Record<string, unknown>,
});

it('GET /api/v1/users/:id follows the contract', async () => {
  const url = '/api/v1/users/123';
  const response = await request(app.getHttpServer()).get(url);
  contract.assertResponse(fromSupertest(response, { method: 'GET', url }));
});
```

`SwaggerModule.createDocument` includes the global prefix in the generated paths, so the prefix is part of the
contract and nothing needs to be guessed. This flow is exercised in `tests/integration/nestjs`.

Because the contract comes from the same decorators that define the responses, it can only catch drift between
the decorated types and the actual payloads. For a stronger check use a contract file reviewed by humans:

```ts
const contract = await loadOpenApiContract({ source: './openapi.yaml' });
```

## Tips

- Decorate responses (`@ApiOkResponse({ type: UserDto })`, `@ApiNotFoundResponse(...)`) so the contract has
  something to compare. Undocumented statuses are reported as `response.status_not_documented`.
- Declare required response headers with `headers` in `@ApiOkResponse`.
- Nest's default exception filter returns `{ statusCode, message, error }`; the schema for error responses must
  allow that shape.
- `@nestjs/swagger` may emit OpenAPI 3.0 documents; both dialects are supported.
