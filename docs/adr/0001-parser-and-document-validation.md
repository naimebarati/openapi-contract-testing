# ADR-0001: Document parsing and structural validation

Status: accepted (Phase 0)

## Context

The design brief proposed `@scalar/openapi-parser` as the first candidate for parsing, validating and
dereferencing OpenAPI documents, and asked for it to be verified, not assumed.

## Evidence (`spikes/phase0`, `npm run evidence:scalar`, `evidence:official-schemas`)

`@scalar/openapi-parser@0.29.19`:

1. **Lenient validation.** `validate()` returned `valid: true` for an OpenAPI 3.1 document without
   `info.version`, and for a schema containing `type: 'strng'`. A false-negative at document level
   means broken contracts load silently. The same document is rejected by the official OAS 3.1 JSON Schema.
2. **Reference confinement is opt-in and not diagnosable.** `bundle()` with `readFiles()` reads files
   outside the document directory unless `basePath` is passed. With `basePath`, a refused file is reported
   via `console.warn` plus a generic "could not resolve" error; the refusal is not distinguishable from
   "not found", so `reference.not_allowed` vs `reference.not_found` cannot be produced reliably. There are no
   `maxFiles` / `maxBytesPerFile` controls.
3. **Dereferencing is destructive for validation purposes.** Siblings of `$ref` are merged into the target
   (`{$ref: X, maxLength: 3}` where X has `maxLength: 5` yields one value, but JSON Schema 2020-12 requires
   both to hold). Circular schemas become cyclic JS object graphs that Ajv cannot consume and
   `JSON.stringify` rejects.
4. **Dependency weight and attack surface.** Runtime tree includes `zod`, `undici` (its own HTTP client and
   URL fetching), `@scalar/types`, `@scalar/openapi-validator` etc. (~20 packages, ~19 MB on disk) for
   functionality we need ~5% of.

`@seriousme/openapi-schema-validator@2.11.0` bundles the official OAS JSON Schemas for 3.0, 3.1 and 3.2
(self-contained, no external `$ref`s) and correctly rejected the documents above. It does not mutate input.
It is ESM-only and reads its schemas with `readFileSync(import.meta.url)`, which complicates dual ESM/CJS
output (Jest runs CJS and cannot load ESM-only dependencies without extra configuration).

## Decision

* Parse with **`yaml`** (`maxAliasCount: 100`, YAML 1.2 core schema) and `JSON.parse`.
* Validate document structure with the **official OAS 3.0 / 3.1 / 3.2 JSON Schemas, vendored into the
  repository** and compiled with Ajv (Ajv draft-04 for 3.0, Ajv 2020 for 3.1/3.2, `strict: false` as these
  meta-level schemas require). The schemas are copied from `@seriousme/openapi-schema-validator`
  (MIT) which redistributes the OpenAPI Initiative schemas; attribution goes into `NOTICE`.
  Refresh procedure is documented next to the vendored files.
* Do **not** depend on `@scalar/openapi-parser`.
* Reference resolution is our own small component (ADR-0002).

## Consequences

* 4 runtime dependencies in total: `ajv`, `ajv-draft-04`, `ajv-formats`, `yaml`.
* We own reference security behaviour and its error codes.
* We must keep the vendored schemas current (tracked in the release checklist).
* Document-level validation does not validate the contents of Schema Objects (the official schemas accept any
  object/boolean there); Schema Objects are validated against the dialect meta-schema when compiled (ADR-0003).
