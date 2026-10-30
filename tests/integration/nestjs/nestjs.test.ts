import 'reflect-metadata';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  ApiNotFoundResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
} from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import type { Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadOpenApiContract } from '../../../src/index.js';
import { fromSupertest } from '../../../src/adapters/supertest.js';
import { textParser } from '../../helpers/text-parser.js';
import { USER, defineReferenceSuite } from '../../helpers/reference-suite.js';
import type { Fault } from '../../helpers/reference-suite.js';

class UserDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String, format: 'email' })
  email!: string;

  @ApiProperty({ type: String, nullable: true, required: false })
  nickname?: string | null;
}

class ErrorDto {
  @ApiProperty({ type: String })
  message!: string;
}

const REQUEST_ID_HEADER = { 'X-Request-Id': { required: true, schema: { type: 'string' } } };

@Controller('users')
class UsersController {
  @Get(':id')
  @ApiOperation({ operationId: 'getUser' })
  @ApiOkResponse({ type: UserDto, headers: REQUEST_ID_HEADER })
  @ApiNotFoundResponse({ type: ErrorDto })
  getUser(
    @Param('id') id: string,
    @Query('fault') fault: Fault | undefined,
    @Res({ passthrough: true }) res: Response,
  ): unknown {
    if (fault === 'not-found') throw new NotFoundException('No such user');
    if (fault === 'status') {
      res.status(500);
      return { message: 'boom' };
    }
    if (fault === 'content-type') {
      res.status(200).set('X-Request-Id', 'r-1').type('text/plain');
      return 'hello';
    }
    if (fault === 'json') {
      res.status(200).set('X-Request-Id', 'r-1').type('application/json');
      return '{"id": "1", ';
    }
    if (fault !== 'header' && fault !== 'multi') res.set('X-Request-Id', 'r-1');
    return fault === 'property' || fault === 'multi' ? { ...USER, email: 42 } : { ...USER, id };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  remove(): void {
    return undefined;
  }
}

describe('NestJS + @nestjs/swagger + Supertest', () => {
  let app: INestApplication;
  const httpServer = (): Server => app.getHttpServer() as Server;
  let document: Record<string, unknown>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [UsersController] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    // The document is generated from the running application, exactly as the Nest docs describe.
    document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Nest').setVersion('1').build(),
    ) as unknown as Record<string, unknown>;
  });

  afterAll(async () => {
    await app.close();
  });

  it('generates an OpenAPI 3.x document whose paths include the global prefix', () => {
    expect(String(document['openapi'])).toMatch(/^3\./);
    expect(Object.keys(document['paths'] as object)).toContain('/api/v1/users/{id}');
  });

  // `spec` is a function: the document is only built in beforeAll.
  defineReferenceSuite(
    'NestJS',
    async (fault) => {
      const url = `/api/v1/users/123${fault ? `?fault=${fault}` : ''}`;
      const res = await request(httpServer()).get(url).buffer(true).parse(textParser);
      return fromSupertest(res, { method: 'GET', url });
    },
    { spec: () => document },
  );

  it('validates the DELETE 204 against the generated document', async () => {
    const contract = await loadOpenApiContract({ document });
    const res = await request(httpServer()).delete('/api/v1/users/1');
    expect(
      contract.validateResponse(fromSupertest(res, { method: 'DELETE', url: '/api/v1/users/1' }))
        .errors,
    ).toEqual([]);
  });
});
