# ADR-0005: Packaging and tooling

Status: accepted (Phase 1)

## Decisions

- **One package with subpath exports** (`.`, later `./jest`, `./vitest`, `./adapters/*`), as in the brief.
- **Dual ESM + CJS output** built with `tsup` (`.js`/`.d.ts` for ESM, `.cjs`/`.d.cts` for CJS), with an explicit
  `exports` map. Reason: Jest runs test files as CommonJS by default and cannot load ESM-only packages without
  `--experimental-vm-modules`; the Jest matcher is a primary use case. `sideEffects: false`.
- **Runtime dependencies (4):** `ajv`, `ajv-draft-04`, `ajv-formats`, `yaml` (ADR-0001/0003). No framework,
  test-runner or TypeScript dependency at runtime.
- **Node `>=22.12.0`.** All dependencies work there; Vitest 5 requires `^22.12`. CI targets 22, 24, 26.
- **TypeScript 6.0.x**, not 7.x: `typescript-eslint@8.72` declares `typescript <6.1.0` as its peer range.
  Revisit when typescript-eslint supports 7. Compiler options: `strict`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `verbatimModuleSyntax`, target ES2023 (Node 22).
- **Tests:** Vitest for unit and integration tests; real Jest 30 and Vitest runs for the matchers (Phase 7).
  Type tests use `expect-type` compiled with `tsc` (`npm run test:types`), including `@ts-expect-error` checks.
- **Lint/format:** ESLint 10 with `typescript-eslint` `strictTypeChecked` (`no-explicit-any` is an error) and Prettier.
- **License:** MIT.

## Consequences

- Output of both module systems is smoke-tested by `scripts/smoke-dist.mjs` and, in Phase 8, from an `npm pack`
  tarball in a clean project.
