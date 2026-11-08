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
3. `git tag v0.1.0-beta.3 && git push origin v0.1.0-beta.3`. The workflow refuses a tag that does not match
   `package.json`, is not on `main`, or whose version is already published; it runs `npm run check` and
   `npm run test:pack`, then `npm publish --provenance`. The dist-tag comes from the version
   (`0.1.0-beta.3` -> `beta`); it refuses a stable `0.x` version as `latest`.
4. Afterwards: `npm dist-tag ls openapi-contract-testing`. A first publish can leave `latest` on the placeholder,
   so `npm install openapi-contract-testing` would install `0.0.0-stage`. Either deprecate the placeholder
   (`npm deprecate openapi-contract-testing@0.0.0-stage "placeholder"`) and point `latest` at the beta
   (`npm dist-tag add openapi-contract-testing@0.1.0-beta.3 latest`, which is what `typeorm-tenant-migrations` has
   for its alpha), or keep `latest` unset and tell users to install `@beta`.
5. In a clean folder: `npm install openapi-contract-testing@beta` and try an example from the README.

> **0.1.0-beta.1 is broken** (published without `dist/`) and is deprecated. `prepack` now builds before any
> pack/publish. See "Fixing a bad release" at the end of this file.

## Status

- [x] Trusted publisher configured on npmjs.com (user `naimebarati`, repository `openapi-contract-testing`, workflow
      `release.yml`); no npm token is stored anywhere.
- [x] `0.1.0-beta.2` published by the release workflow with provenance; `latest` and `beta` moved to it by hand,
      `0.0.0-stage` and `0.1.0-beta.1` deprecated.
- [x] CI green on Ubuntu (Node 22, 24, 26), Windows (Node 24) and the benchmark job.
- [x] The packed tarball was installed into separate projects: NestJS 11 + Jest 30 + ts-jest, Express + Supertest +
      Fastify + Axios + Vitest 5 (TypeScript, `bundler`), plain CommonJS Jest, and a plain ESM script using fetch and
      Axios against a real `node:http` server.
- [x] That testing found that `moduleResolution: node10` could not resolve the subpath types; fixed with
      `typesVersions` in `0.1.0-beta.3` and covered by `npm run test:pack`.
- [x] `0.1.0-beta.3` published by the release workflow (tag `v0.1.0-beta.3`, provenance); `latest` and `beta` moved to
      it, `0.1.0-beta.2` deprecated. Installed from the registry into fresh ESM, CommonJS and TypeScript projects.
- [x] GitHub release `v0.1.0-beta.3` created and marked "pre-release".
- [x] Scheduled checks in place (Dependabot, `compat.yml`); see "Ongoing compatibility checks".
- [ ] **open** Next: use the beta on a real project (see the open item below) before any `0.1.0`.

## Checklist for `0.1.0-beta.1` (history)

- [x] `npm run check` passes (format, lint, typecheck, unit + integration, build, dist smoke, type tests, Jest).
- [x] `npm run test:pack` passes (tarball installed into independent ESM, CJS and TypeScript projects).
- [x] Full test suite, dist smoke and Jest suite pass on Node 22.22, 24.22 and 26.13 (local runs).
- [x] CI matrix: the first GitHub run (commit 07b4e4e) completed with conclusion `success` for Node 22, 24 and 26
      and for the benchmark job.
- [x] `npm audit --omit=dev`: 0 vulnerabilities. Licenses of runtime dependencies reviewed (docs/security.md).
- [x] License of the vendored OpenAPI schemas verified against the upstream repository (OAI/spec.openapis.org,
      Apache-2.0); license text shipped in `third-party/`, changes documented in `NOTICE` and
      `src/loader/schemas/README.md`.
- [x] Package name: kept as `openapi-contract-testing` (the maintainer's decision) and now claimed on npm. A
      trademark review of "OpenAPI" in the name was not done.
- [x] Ran against nine large public specifications (docs/real-world-results.md); findings fixed.
- [ ] **open** Talk to a few teams using `jest-openapi`/`vitest-openapi`-style tools and run the beta on a real
      project before promoting to `latest`.
- [x] Version and CHANGELOG updated for each release.
- [x] Published through `.github/workflows/release.yml`.
- [x] Create a GitHub release marked "pre-release" for the beta.

## Ongoing compatibility checks

CI only runs on pushes and uses the locked versions, so two scheduled jobs watch for breakage that nobody pushed:

- `.github/dependabot.yml`: weekly update PRs (one for development tooling, one for runtime dependencies, one for
  GitHub Actions; every major version on its own). They go through the normal CI and are never merged automatically.
- `.github/workflows/compat.yml` (Mondays, also runnable by hand): installs without the lockfile, so it gets the newest
  versions package.json allows, on Node 22, 24 and the newest Node, and runs typecheck, tests, build, dist, type, Jest
  and pack tests. A `published` job installs the package from the
  npm registry (`latest` and `beta`) into fresh ESM, CommonJS and TypeScript projects (`OCT_PUBLISHED_SPEC=... npm run
test:published` does the same by hand, for example `openapi-contract-testing@0.1.0-beta.3` right after a release). A
  further job also installs new majors of Jest, Vitest, Ajv and yaml as an early warning. A failure
  opens or updates one issue labelled `compat`; the next green run closes it. Look at that issue before every release.

## Before 1.0

All acceptance criteria of the design brief must hold, each with a test, plus: real-world specs (large public
OpenAPI documents) loaded in CI, Windows in the CI matrix, a decision on remote `$ref` (implement with SSRF
tests, or keep it out), and support statements for Jest/Vitest versions other than the tested ones.

## Fixing a bad release

npm versions are immutable: a published version number can never be reused, even after `npm unpublish`. So:

1. Fix the cause, bump the version (for example `0.1.0-beta.2`) and release it.
2. Deprecate the bad version so nobody installs it by accident (needs `npm login`):
   `npm deprecate openapi-contract-testing@0.1.0-beta.1 "Published without dist/; use 0.1.0-beta.2"`.
   (`npm unpublish` is only possible within 72 hours and still burns the version number.)
3. Make sure `latest`/`beta` point at the fixed version: `npm dist-tag ls openapi-contract-testing`.
4. Verify as a user would, in an empty folder: `npm install openapi-contract-testing@beta` and run a README example.
   Check the file list too: `npm view openapi-contract-testing@<version> dist.unpackedSize` should be about 1.6 MB (about 290 kB packed), not the 39 kB of the broken 0.1.0-beta.1.
