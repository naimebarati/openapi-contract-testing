import { expect as jestExpect } from '@jest/globals';
import { expect as vitestExpect } from 'vitest';
import type { OpenApiContract } from '../../src/index.js';
import '../../src/jest.js';
import '../../src/vitest.js';

declare const contract: OpenApiContract;
declare const exchange: { request: { method: string; url: string }; response: { status: number } };

// Both runners get the typed matcher, including .not and .resolves.
jestExpect(exchange).toConformToOpenApi(contract);
jestExpect(exchange).not.toConformToOpenApi(contract);
vitestExpect(exchange).toConformToOpenApi(contract);
vitestExpect(exchange).not.toConformToOpenApi(contract);

// @ts-expect-error the argument must be an OpenApiContract
jestExpect(exchange).toConformToOpenApi('openapi.yaml');
// @ts-expect-error the argument must be an OpenApiContract
vitestExpect(exchange).toConformToOpenApi('openapi.yaml');
