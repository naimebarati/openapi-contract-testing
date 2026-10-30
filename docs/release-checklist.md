# Release checklist

Nothing has been published. These steps are for the maintainer; items marked **open** were not done or could not
be verified from the development environment.

## Before `0.1.0-beta.1`

- [x] `npm run check` passes (format, lint, typecheck, unit + integration, build, dist smoke, type tests, Jest).
- [x] `npm run test:pack` passes (tarball installed into independent ESM, CJS and TypeScript projects).
- [x] Full test suite, dist smoke and Jest suite pass on Node 22.22, 24.22 and 26.13 (local runs).
- [ ] **open** CI matrix: first GitHub run (commit 07b4e4e) was observed while in progress; Node 26 finished
      green, Node 22 had passed every step, Node 24 had passed every step up to `test:pack`. Confirm the final
      result of that run and of the benchmark job on the Actions page.
- [x] `npm audit --omit=dev`: 0 vulnerabilities. Licenses of runtime dependencies reviewed (docs/security.md).
- [ ] **open** Confirm the license of the vendored OpenAPI schemas against the upstream repository
      (https://github.com/OAI/OpenAPI-Specification) and that `NOTICE` is accurate.
- [ ] **open** Package name: on 2026-10-30 `npm view openapi-contract-testing` returned 404 (name unclaimed).
      Re-check immediately before publishing, look at similar names (`npm search openapi contract`), consider a
      scope (`@your-scope/openapi-contract-testing`), and review trademark use of "OpenAPI" in the name.
- [ ] **open** Talk to a few teams using `jest-openapi`/`vitest-openapi`-style tools and run the beta on a real
      project before promoting to `latest`.
- [ ] Update `version` in `package.json` (`0.1.0-beta.1`) and the CHANGELOG date.
- [ ] Publish with a pre-release tag only: `npm publish --tag beta --provenance` (provenance needs a trusted CI
      environment; see `.github/workflows/release.yml`, which is untested). Do not publish `latest`.
- [ ] Create a GitHub release marked "pre-release".

## Before 1.0

All acceptance criteria of the design brief must hold, each with a test, plus: real-world specs (large public
OpenAPI documents) loaded in CI, Windows in the CI matrix, a decision on remote `$ref` (implement with SSRF
tests, or keep it out), and support statements for Jest/Vitest versions other than the tested ones.
