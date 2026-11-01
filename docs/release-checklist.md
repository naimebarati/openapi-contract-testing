# Release checklist

Nothing has been published. These steps are for the maintainer; items marked **open** were not done or could not
be verified from the development environment.

## How a release works (npm trusted publishing, no stored token)

This is the same model as `naimebarati/typeorm-tenant-migrations`: npm's registry shows its `0.1.0-alpha.2` was
published by "GitHub Actions" through a trusted publisher with provenance, and its first version by hand. There is
no `NPM_TOKEN` secret, so nothing to rotate or leak, and granular tokens are not needed.

**One time, from your machine** (trusted publishing needs the package to exist, and a repository that is public):

1. Make the GitHub repository public (Settings > Danger Zone), and enable Private vulnerability reporting,
   Dependabot alerts and Secret scanning (Settings > Code security).
2. Create the package with a placeholder, in an empty folder (not this repository):
   ```bash
   mkdir /tmp/placeholder && cd /tmp/placeholder
   cat > package.json <<'JSON'
   { "name": "openapi-contract-testing", "version": "0.0.0-stage", "description": "Placeholder; the first real release is published from GitHub Actions.", "license": "MIT" }
   JSON
   npm login                         # browser + your 2FA
   npm publish --access public --tag stage
   ```
3. On npmjs.com open the package > Settings > Trusted Publisher > GitHub Actions and enter:
   user/organization `naimebarati`, repository `openapi-contract-testing`, workflow filename `release.yml`
   (environment: empty). Optionally set "Require two-factor authentication and disallow tokens" for the package.

**Every release:**

1. Set `version` in `package.json`, update `CHANGELOG.md`, merge to `main`, wait for a green `ci.yml`.
2. Optional rehearsal: Actions > Release > Run workflow. It runs every check and ends in `npm publish --dry-run`.
3. `git tag v0.1.0-beta.1 && git push origin v0.1.0-beta.1`. The workflow refuses a tag that does not match
   `package.json`, is not on `main`, or whose version is already published; it runs `npm run check` and
   `npm run test:pack`, then `npm publish --provenance`. The dist-tag comes from the version
   (`0.1.0-beta.1` -> `beta`); it refuses a stable `0.x` version as `latest`.
4. Afterwards: `npm dist-tag ls openapi-contract-testing`. A first publish can leave `latest` on the placeholder,
   so `npm install openapi-contract-testing` would install `0.0.0-stage`. Either deprecate the placeholder
   (`npm deprecate openapi-contract-testing@0.0.0-stage "placeholder"`) and point `latest` at the beta
   (`npm dist-tag add openapi-contract-testing@0.1.0-beta.1 latest`, which is what `typeorm-tenant-migrations` has
   for its alpha), or keep `latest` unset and tell users to install `@beta`.
5. In a clean folder: `npm install openapi-contract-testing@beta` and try an example from the README.

## Before `0.1.0-beta.1`

- [x] `npm run check` passes (format, lint, typecheck, unit + integration, build, dist smoke, type tests, Jest).
- [x] `npm run test:pack` passes (tarball installed into independent ESM, CJS and TypeScript projects).
- [x] Full test suite, dist smoke and Jest suite pass on Node 22.22, 24.22 and 26.13 (local runs).
- [x] CI matrix: the first GitHub run (commit 07b4e4e) completed with conclusion `success` for Node 22, 24 and 26
      and for the benchmark job.
- [x] `npm audit --omit=dev`: 0 vulnerabilities. Licenses of runtime dependencies reviewed (docs/security.md).
- [x] License of the vendored OpenAPI schemas verified against the upstream repository (OAI/spec.openapis.org,
      Apache-2.0); license text shipped in `third-party/`, changes documented in `NOTICE` and
      `src/loader/schemas/README.md`.
- [ ] **open** Package name: on 2026-10-30 `npm view openapi-contract-testing` returned 404 (name unclaimed).
      Re-check immediately before publishing, look at similar names (`npm search openapi contract`), consider a
      scope (`@your-scope/openapi-contract-testing`), and review trademark use of "OpenAPI" in the name.
- [x] Ran against nine large public specifications (docs/real-world-results.md); findings fixed.
- [ ] **open** Talk to a few teams using `jest-openapi`/`vitest-openapi`-style tools and run the beta on a real
      project before promoting to `latest`.
- [ ] Update `version` in `package.json` (`0.1.0-beta.1`) and the CHANGELOG date.
- [ ] Publish through `.github/workflows/release.yml` (see "How a release works"; the workflow has not run yet).
- [ ] Create a GitHub release marked "pre-release".

## Before 1.0

All acceptance criteria of the design brief must hold, each with a test, plus: real-world specs (large public
OpenAPI documents) loaded in CI, Windows in the CI matrix, a decision on remote `$ref` (implement with SSRF
tests, or keep it out), and support statements for Jest/Vitest versions other than the tested ones.
