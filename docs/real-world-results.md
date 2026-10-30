# Real-world specification results

Run on 2026-10-30 against public OpenAPI documents downloaded from their projects' `main`/`master` branches
(sizes below; no version pinning, so numbers will drift). Tool: `scripts/real-world.mjs` (not part of the test
suite or CI; needs network access to fetch the documents).

```bash
npm run build
node --max-old-space-size=4096 scripts/real-world.mjs path/to/openapi.yaml --limit 5000
```

## Method

1. Load with default options (unsupported features as warnings).
2. For every JSON response of every operation, build an instance **from the schema** with an independent generator
   (required properties only; enums, formats, bounds; `allOf`/`oneOf`/discriminators). Expectation: **valid**.
   A failure is either a false positive of this package or a limit of the generator, and was inspected by hand.
3. Change the type of one required top-level property. Expectation: **invalid** (checks for false negatives).

Limits of the method: the generator skips `pattern`, `if/then/else`, non-JSON media types, paths containing a
`#` fragment, and anything it cannot satisfy; it only exercises what it can build. It shows the absence of false
positives on these inputs, not correctness in general.

## Results

| Document                                      | OpenAPI |       Size | Operations |  Load | Heap after load | Valid instances |          Mutations caught |
| --------------------------------------------- | ------- | ---------: | ---------: | ----: | --------------: | --------------: | ------------------------: |
| Petstore (expanded)                           | 3.0.0   |       5 kB |          4 | 0.2 s |           16 MB |           3 / 3 |                     2 / 2 |
| Twilio API v2010                              | 3.0.1   |     1.9 MB |        197 | 1.1 s |           46 MB |       168 / 168 | n/a (no required scalars) |
| Box                                           | 3.0.2   |     1.8 MB |        297 | 2.0 s |           71 MB |       607 / 607 |                   79 / 79 |
| Discord                                       | 3.1.0   |     1.2 MB |        250 | 2.3 s |           66 MB |       580 / 580 |                 528 / 528 |
| Plaid                                         | 3.0.0   |     3.3 MB |        350 | 4.1 s |          282 MB |       339 / 339 |                 314 / 314 |
| OpenAI                                        | 3.1.0   |     4.3 MB |        376 | 8.1 s |          241 MB |     1728 / 1728 |                 348 / 348 |
| Stripe                                        | 3.0.0   |     8.3 MB |        612 | 7.2 s |          169 MB |       529 / 529 |                 528 / 528 |
| GitHub REST                                   | 3.0.3   |    13.9 MB |       1254 | 7.9 s |          155 MB |     3023 / 3026 |                 931 / 932 |
| DigitalOcean (split into ~thousands of files) | 3.0.0   | 19 MB repo |        866 | 7.8 s |          180 MB |     load only * |               load only * |

\* DigitalOcean puts `$ref` where OpenAPI does not allow it (in place of Operation Objects, whole `headers` maps
and `description` strings). The package rejects that with a message that says so; to test the rest I inlined
those positions with a throw-away script (not committed) and loaded the result, which then exercises ~thousands of
real relative file references. The generator cannot follow cross-file references, so only 1 instance was built:
this row proves loading, reference confinement and compilation, not response validation.

The 3 "invalid" GitHub instances and the 1 uncaught mutation are properties of the specification, verified by
reading it: both validation-error schemas (`validation-error`, `validation-error-simple`) have identical required
fields, so any minimal payload matches both branches of their `oneOf`; and `page-deployment.id` is
`oneOf: [integer, string]`, so changing it to a string is not a violation.

## What this found (all fixed, each with a regression test)

| Finding                                                                                                                                                                | Document                     | Fix                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `URI scheme is malformed`: Ajv read `{"id": "a:b"}` inside an `example` as a schema id (draft-04)                                                                      | Box                          | Documentation-only keywords (`example`, `default`, `xml`, `description`, ...) are no longer copied into the compiled schemas |
| Valid _array_ responses rejected: a `discriminator` on a `oneOf` that has an array variant; `required`/`properties` pass vacuously on arrays, so every variant applied | GitHub contents API          | Discriminator dispatch only for objects whose value names a variant; everything else uses plain `oneOf`                      |
| Valid responses would be rejected when discriminator values are not schema names (`type: message` vs schema `Message`)                                                 | OpenAI                       | Unmapped values fall back to plain `oneOf`                                                                                   |
| Load failed with `spec.path_collision` for two paths that differ only in parameter names but have different methods                                                    | GitHub                       | Now a load warning; ambiguous only for methods they share                                                                    |
| Pattern `^[a-zA-Z0-9_\-\:]+$` rejected ("Invalid escape" in Unicode mode)                                                                                              | DigitalOcean                 | Compiled without the `u` flag when it fails with it, with a warning                                                          |
| Confusing "must have required property 'responses'" for `get: {$ref: ...}`                                                                                             | DigitalOcean                 | Clear message: a `$ref` is not allowed at this position; bundle first                                                        |
| 18.7 s load for thousands of small files (50 % GC): a `maxBytes + 1` buffer per file                                                                                   | DigitalOcean                 | Buffer sized from `fstat` (load 7.3 s)                                                                                       |
| Default `maxBytesPerFile` (5 MiB) rejected Stripe and GitHub; default `maxFiles` (50) rejected split documents                                                         | Stripe, GitHub, DigitalOcean | Defaults raised to 32 MiB and 1000                                                                                           |

## Observations, not fixed

- Loading cost scales with the number of distinct schemas (compilation): 4-8 s and 150-280 MB for the large
  documents. Validation afterwards takes tens of microseconds.
- Real documents trigger warnings that are worth reading: unknown formats (`phone-number`, `uri-reference` variants,
  ...), discriminators without resolvable mapping, and patterns that needed the non-Unicode fallback. They are
  returned by `contract.getWarnings()`.
- Documents that use `$ref` in non-standard positions need a bundler first.
