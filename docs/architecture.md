# Architecture

```text
 Test runner (Jest / Vitest / any)
        │  optional
 Matchers  src/matchers, src/jest.ts, src/vitest.ts      toConformToOpenApi → validateResponse
        │
 Adapters  src/adapters/*                                 client response → HttpExchange (no OpenAPI logic)
        │
 Core API  src/contract/load-openapi-contract.ts          validateResponse / assertResponse
        │
 ┌──────┴────────────────┬───────────────────────┐
 Operation index         Response validator      Diagnostics
 src/routing             src/validation          src/diagnostics
 └──────┬────────────────┴───────────────────────┘
        │
 Normalized contract   src/normalize                       immutable model of operations/responses
        │
 Schema compiler       src/validation/schema-*             one Ajv instance per dialect, compiled once
        │
 Loader                src/loader                          parse, validate structure, resolve references safely
```

Rules that keep the layers honest:

- **One implementation of the rules.** Matchers and adapters never validate anything. Matchers call
  `contract.validateResponse()`; adapters build an `HttpExchange`.
- **Load once, validate many.** `loadOpenApiContract` loads and validates the document, resolves references,
  builds the model and compiles every schema. `validateResponse` only looks things up and runs compiled
  validators, with no state shared between calls.
- **No silent skipping.** Unsupported contract features are collected in `LoadDiagnostics` and become load errors
  or warnings (`unsupportedFeaturePolicy`); unsupported bodies become warnings on the result.
- **No mutation.** The document is snapshotted and deep-frozen at load; exchanges are only read.

## Data flow

1. **Loader** (`load-document.ts`): read source with size limits, parse YAML/JSON (`yaml-json-parser.ts`),
   detect the version, validate the structure against the vendored official schema (`spec-validator.ts`).
   `ReferenceResolver` resolves `$ref` strings and reads files only inside the root directory.
2. **Normalizer** (`normalize-document.ts`): resolves Reference Objects outside schemas and records, per
   operation, server path prefixes, responses, headers and media types, plus where each schema lives.
3. **Operation index** (`operation-index.ts`): hash lookup for static routes, buckets for templated routes;
   detects collisions at load and ambiguity at lookup.
4. **Schema compiler** (`schema-transformer.ts`, `schema-compiler.ts`, `dialects/`): turns Schema Objects into
   dialect-correct JSON Schema in a registry (decisions: ADR-0002, 0003, 0004), links cycle-closing references
   lazily, compiles in dependency order, and maps validation errors back to contract locations.
5. **Response validator** (`validate-response.ts` and friends): operation → status → headers → Content-Type →
   body presence → parse → schema.
6. **Diagnostics**: issues are plain objects; `format-result.ts` renders them and is not used by the validator.

## Decisions

Architecture decision records live in [docs/adr](adr): parser and document validation, reference resolution,
schema engine and dialects, direction-aware schemas and discriminator, packaging.
