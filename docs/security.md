# Security notes

The package reads files and (optionally) user supplied schemas. This is what it does about it, and what it cannot.

## Threat model

Inputs you control: the OpenAPI document and the files it references. Inputs a test harness may influence: the
HTTP exchange (status, headers, body). The package is meant for development and CI, not for untrusted input at
runtime.

## Reference handling

- Only local files below a root directory are read. The root and every target are compared after `realpath`, so
  `..`, absolute paths, percent-encoded traversal (`%2e%2e`, `%2f`), NUL bytes and symlinks cannot escape it.
  Existence of files outside the root is not revealed (both existing and missing paths give `reference.not_allowed`).
- URL schemes are refused. Remote references and URL sources are **not implemented**, so there is no SSRF surface.
  Messages never contain credentials or query values of a refused URL.
- Limits: files per document (`refs.maxFiles`, 1000), bytes per file (`refs.maxBytesPerFile`, 32 MiB, checked with
  `fstat` and while reading), only regular files, YAML alias expansion (100) so alias bombs fail instead of
  exhausting memory. The reference graph between schemas is traversed iteratively. The nesting depth inside one
  schema is limited by the call stack (a few hundred levels); deeper documents fail with a controlled
  `OpenApiSpecError`/`OpenApiConfigError` ("nested too deeply"), never with a raw `RangeError`.
- Prototype pollution: `__proto__`/`constructor` keys in documents are plain data; JSON Pointer traversal uses
  own properties only.
- Tests: `tests/security`.

## Validation

- No network I/O in validation. Inputs and documents are never mutated (the document snapshot is frozen).
- `coerceTypes`, `useDefaults` and `removeAdditional` are off, so responses are never altered.
- Diagnostics omit response values by default (messages describe types and locations). `includeActualValues`
  adds truncated values; header values of `Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie`,
  `X-API-Key`, `X-Auth-Token`, `X-CSRF-Token`, ... and names containing `token`, `secret`, `password` or `api-key`
  stay `[redacted]`. JSON parse errors never echo the payload.
- `maxBodyBytes` stops raw payloads from being parsed; the Fetch adapter stops reading after `maxBodyBytes + 1`.

## Known limits

- **Regular expressions.** `pattern`, `patternProperties` and custom formats run as JavaScript regular
  expressions; a hostile or careless pattern can take very long (ReDoS) and JavaScript offers no timeout. Load
  contracts you trust. (Ajv uses the Unicode-aware `u` flag where it is available.)
- **Parsed bodies.** The size of an already parsed `body` is not measured.
- **Custom formats** are synchronous functions you provide; they are your code.
- **Vendored schemas** are copies of the official OpenAPI JSON Schemas; they are refreshed manually
  (see `src/loader/schemas/README.md`).

## Dependency review (this repository, 2026-10-30)

- Runtime dependencies and licenses: `ajv` 8.20 (MIT), `ajv-draft-04` 1.0 (MIT), `ajv-formats` 3.0 (MIT),
  `yaml` 2.9 (ISC); transitive: `fast-deep-equal` (MIT), `fast-uri` (BSD-3-Clause), `json-schema-traverse` (MIT),
  `require-from-string` (MIT). `npm audit --omit=dev`: 0 vulnerabilities.
- `npm audit` for development dependencies reports 5 low-severity advisories, all through Jest's `deepmerge`
  (dev only, not shipped).

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository (Security tab) instead of a public issue.
