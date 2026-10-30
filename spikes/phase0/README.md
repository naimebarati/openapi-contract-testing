# Phase 0 spike

Throw-away prototype and evidence scripts behind the decisions in `docs/adr/`.
Nothing here is published or imported by the package.

```bash
cd spikes/phase0
npm install
npm test                       # 34 tests: dialects, refs, security, discriminator, readOnly/writeOnly
npm run evidence:scalar        # @scalar/openapi-parser behaviour that led to ADR-0001
npm run evidence:official-schemas
npm run evidence:converter     # @openapi-contrib converter vs OAS 3.0 ground truth (ADR-0003)
npm run evidence:perf
```

`proto.mjs` is the prototype pipeline (reference resolver with root confinement, position-aware
Schema Object transform, schema registry, Ajv factories). The production implementation in `src/`
is a typed rewrite informed by these results, not a copy.

Tested on Node 22.22.0, 24.22.2 and 26.13.0 (all 34 tests pass on each).

Notes

- No lockfile is committed on purpose. `@openapi-contrib/openapi-schema-to-json-schema@5.1.1` (rejected in ADR-0003)
  pulls in dependencies with known high-severity advisories, so it is not declared in `package.json`;
  `npm run evidence:converter` installs it with `--no-save` only when you ask for that evidence.
- `fixtures/split/linkout` is a symlink (the symlink-escape test); it needs symlink support on checkout.
