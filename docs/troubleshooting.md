# Troubleshooting

## Loading fails

**`The OpenAPI document is not valid:` ...** The structure does not match the official schema of its version.
Each line shows the JSON Pointer (`/paths/~1users/get/responses/200/description`) and the reason. `~1` stands for
`/` in a pointer.

**`The OpenAPI document uses features that are not supported`** Lists what is not supported and where. Either
change the document or set `validation.unsupportedFeaturePolicy: 'warning'` and read `contract.getWarnings()`.
Typical causes: `nullable` in an OpenAPI 3.1/3.2 document (use `type: [T, 'null']`), `$anchor`/`$id`/`$dynamicRef`
in schemas, a custom `jsonSchemaDialect`, `$self`, `itemSchema`, headers defined with `content`.

**`reference.not_allowed`** A `$ref` points outside the root directory, uses a URL scheme (`http:`, `file:`...),
exceeds `refs.maxFiles`/`refs.maxBytesPerFile`, or the document has no directory to resolve file references from.
Pass `source`, or `baseDir` / `refs.rootDir` for `document` and `content` inputs.

**`reference.not_found`** The file or JSON Pointer does not exist. Messages show paths relative to the root
directory.

**`schema.compile_failed`** A schema is invalid for its dialect (for example `type: strng`, a malformed `pattern`,
or the 3.0-style boolean `exclusiveMinimum` in a 3.1 document). The message includes the location in the contract.

**`spec.path_collision`** Two paths differ only in parameter names (`/users/{id}` and `/users/{name}`), or with
`trailingSlash: 'ignore'` only in a trailing slash.

## A response is reported but looks right

**`operation.not_found`** Check the method and path in the message. If it says the path is documented for other
methods, the contract lacks that method. If the message hints that the path matches once a prefix is removed, the
prefix is missing from `servers` (or set `routing.basePath`). Query strings are ignored.

**`operation.ambiguous`** Two templates both match and neither is strictly more specific
(`/{a}/b/c` vs `/a/{b}/{c}`). Make the contract unambiguous.

**`response.status_not_documented`** Add the status, a range (`4XX`) or `default`.

**`response.content_type_missing` / `_unexpected`** The exchange needs the real `Content-Type` header. Parameters
like `charset` are ignored. `application/problem+json` only matches if the contract lists it (or a wildcard).

**`response.body_missing` vs `response.body_unexpected`** The contract defines `content` but there was no/empty
body, or it defines none but a body arrived. For Supertest build the exchange with `fromSupertest` or pass
`bodyPresent: response.text.length > 0`.

**`response.body.invalid_json`** The payload is not JSON although Content-Type says so. With Supertest see
[express.md](express.md); with Axios use `responseType: 'text'` or `'arraybuffer'`.

**`response.body.schema_invalid`** `Path` is the location in the body (`$.items[0].id`), `Contract` the location in
the contract. Add `validation.includeActualValues: true` locally to see (truncated) received values; do not enable
it where logs are shared.

**A `writeOnly` property was flagged.** It appeared in a response. Fix the API, or set
`validation.writeOnlyInResponse` to `'warning'`/`'ignore'`.

**Warnings about unknown formats.** Register them: `validation.customFormats: { 'my-format': /^...$/ }`.

## Performance

Loading compiles every schema once (about 2.5 s for 1000 operations in `benchmarks/`); reuse the contract
instance (for example in a global setup or a module-level `await`). Validation takes tens of microseconds.

## Environment

- Node.js >= 22.12 is required.
- Jest native ESM mode and Vitest versions other than 5 are not covered by the tests.
- Windows: file reference confinement and symlink tests run in CI on Linux; Windows is not part of the CI matrix.
