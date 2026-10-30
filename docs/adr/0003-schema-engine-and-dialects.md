# ADR-0003: Schema engine and dialect handling

Status: accepted (Phase 0)

## Decision

- **Ajv 8** with **separate instances per dialect**: `ajv-draft-04` for OAS 3.0, `ajv/dist/2020` for OAS 3.1 and
  3.2 (Ajv documents that 2020-12 cannot be mixed with older drafts in one instance). Formats from `ajv-formats`;
  user formats via options (sync only).
- Options: `allErrors: true`, `coerceTypes: false`, `useDefaults: false`, `removeAdditional: false`,
  `validateFormats: true`, `strictSchema: true` (unknown keywords throw), `discriminator: false`,
  `allowUnionTypes: true`.
  **`strictTypes: false` and `strictRequired: false`** deliberately: spike tests showed Ajv's strict mode rejects
  valid, common OpenAPI (`maxLength` without `type`; `required` listing properties declared in a sibling `allOf`
  member). They are style lints, not correctness checks; keeping them on would produce false load failures.
- OAS annotation keywords (`discriminator`, `xml`, `externalDocs`, `example`, plus `readOnly`, `writeOnly`,
  `deprecated` for the draft-04 instance) are registered explicitly. `x-*` extensions are removed only at Schema
  Object keyword positions; a property _named_ `x-foo` or `nullable` is data and is preserved.
- Unknown keywords produce `spec.unsupported_feature` (error or warning per `unsupportedFeaturePolicy`) instead of
  being dropped. Unknown `format` values fail compilation unless the user registers them.

## OAS 3.0: path B (own adapter), path A rejected

`@openapi-contrib/openapi-schema-to-json-schema@5.1.1` was evaluated (`npm run evidence:converter`):

- 13/14 ground-truth cases correct, but `{type: string, nullable: true, enum: [a, b]}` accepts `null`.
  OAS 3.0.3 says `nullable` adds `null` to `type` only and that `enum` still applies, so `null` must be rejected.
  That is a silent weakening of the contract, i.e. a false negative.
- It works on whole dereferenced trees without knowing keyword positions, produces no diagnostics for unsupported
  keywords, and requires dereferencing first (conflicts with ADR-0002).
- `npm audit` reports 2 high + 2 moderate advisories in its dependency chain (`openapi-typescript` ->
  `undici@5` -> `@fastify/busboy`), and it ships `lodash`, `yargs` and `@types/node` as runtime dependencies.

The adapter lives in the schema transformer (prototype: `proto.mjs`): a position-aware walk over Schema Object
keywords that emits draft-04 for 3.0 (`nullable` -> `type: [T, "null"]` only when `type` is a string; boolean
`exclusiveMinimum/Maximum` passed through to draft-04 unchanged; `$ref` siblings reported, since 3.0 ignores them)
and 2020-12 for 3.1/3.2 (no rewriting except `$ref` -> registry and the direction handling of ADR-0004).
`nullable` inside a 3.1/3.2 schema is reported rather than honoured.

Proof: `spikes/phase0/phase0.test.mjs` (34 tests, passing on Node 22.22, 24.22, 26.13).

## OAS 3.2

The 3.2 _document_ structure is validated with the official 3.2 schema (QUERY method, `additionalOperations`,
`$self`, `itemSchema`...). Schema Objects use the same 2020-12 pipeline as 3.1. Features that change response
semantics but are not implemented in v1 (`itemSchema` / streaming media types, `$self`-based reference bases,
`additionalOperations` routing until Phase 3 proves it) are reported as `spec.unsupported_feature`, never ignored.

## Performance finding

Compiling 1000 entries over 200 distinct cyclic definitions took ~1.0 s (transform ~0.08 s); 10 000 validations
~0.2 s. Compilation is therefore the cost to manage: validators are compiled once per schema and cached; Phase 4
decides eager vs lazy compilation using the 1000-operation benchmark.

## Addendum (Phase 4): large and cyclic reference graphs

Finding: Ajv compiles `$ref` targets recursively. A ring of 300 mutually referencing schemas (or a long chain)
raised `Maximum call stack size exceeded`; real specifications with large strongly-connected schema graphs
behave the same way. Decision, implemented in `SchemaRegistry.linkAndOrder` and covered by
`tests/unit/validation/deep-references.test.ts` (ring of 600, chain of 1500, all dialects):

1. Build the reference graph while transforming and run an iterative DFS from the entry schemas.
2. References that close a cycle (DFS back edges) become the custom `octRef` keyword, which resolves its target
   on first use. All other references stay native Ajv `$ref`, so `unevaluatedProperties` and `$ref` sibling
   semantics are unaffected for them.
3. Definitions are compiled in post-order (leaves first), so each native `$ref` points at an already compiled
   definition and the recursion depth stays constant.

Known limitation: `unevaluatedProperties` / `unevaluatedItems` do not see annotations across a cycle-closing
reference. This only matters when a recursive reference is used as a sibling/`allOf` member of the schema that
references it back, which we have not seen in practice.

Error locations: Ajv reports schema paths relative to whichever compiled function raised the error, which cannot
be attributed to a contract location. Ajv runs in `verbose` mode and every transformed node is registered in a
`WeakMap`, so an error's `parentSchema` maps exactly to the original `file#/pointer` of the schema node
(`/components/schemas/M2/properties/v/type`). Generated nodes (discriminator guards, the writeOnly marker) map to
the `discriminator` / property they were generated from. Raw Ajv errors (which include data in verbose mode) never
leave the compiler.
