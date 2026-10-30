# Changelog

All notable changes are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 0.1.0-beta.1 (unreleased, not yet published)

- Project scaffolding, public types and error classes.
- Document loader: YAML/JSON/object inputs, structural validation against the official OpenAPI 3.0/3.1/3.2
  schemas, option validation, and a reference resolver confined to a root directory.
- Normalized contract model, server/base-path handling and a method+path operation index with static-over-parameter
  precedence, collision and ambiguity detection.
- Schema compiler: per-dialect Ajv instances (draft-04 for OAS 3.0, 2020-12 for 3.1/3.2), position-aware schema
  transformer, readOnly/writeOnly and discriminator handling, stack-safe compilation of large reference graphs and
  precise contract locations for validation errors.
- Response validation: status resolution, response headers, Content-Type and media-type selection, JSON/text body
  handling (absent vs empty vs `null`), HEAD/204/304 rules, structured diagnostics with redaction, text/JSON
  formatters, and `loadOpenApiContract` with `validateResponse` / `assertResponse`.
- Adapters for Fetch, Supertest, Axios and Fastify `inject()` as subpath exports, with integration tests against
  real Express, Fastify and NestJS (generated Swagger document) servers.
- Jest (`openapi-contract-testing/jest`) and Vitest (`openapi-contract-testing/vitest`) matchers
  `toConformToOpenApi(contract)` with `.not`, `.resolves` and type augmentation, tested with real Jest 30 (CommonJS
  build, with and without injected globals) and Vitest 5.
- English documentation, supported-features matrix, architecture and security notes, runnable Express + Vitest example,
  benchmark with recorded baseline, CI (Node 22/24/26) and a pre-release-only publish workflow.
- Bounded failure modes for pathological documents (deep nesting, alias bombs).
