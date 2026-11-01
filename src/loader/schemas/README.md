# Vendored OpenAPI document schemas

`oas-3.0.schema.json`, `oas-3.1.schema.json`, `oas-3.2.schema.json` validate the _structure_ of an OpenAPI
document (Schema Object contents are validated later, when schemas are compiled; see ADR-0001/0003).

## Origin and license

Copied from the OpenAPI Initiative's website repository, https://github.com/OAI/spec.openapis.org
(commit `b61ab81028c6c7a322b05bb4b5874fea69a7343c`, 2026-10-27), which is licensed under the **Apache License 2.0**
(its `LICENSE` was checked; a copy is shipped as `third-party/OpenAPI-Initiative-LICENSE-Apache-2.0.txt`).

| File                  | Upstream file (`oas/...`) | Changes from upstream                                                      |
| --------------------- | ------------------------- | -------------------------------------------------------------------------- |
| `oas-3.0.schema.json` | `3.0/schema/2024-10-18`   | none (re-serialized with Prettier)                                         |
| `oas-3.1.schema.json` | `3.1/schema/2026-08-03`   | `"$dynamicRef": "#meta"` replaced by `"$ref": "#/$defs/schema"` (4 places) |
| `oas-3.2.schema.json` | `3.2/schema/2026-08-30`   | `"$dynamicRef": "#meta"` replaced by `"$ref": "#/$defs/schema"` (5 places) |

The `$dynamicRef` replacement is needed because Ajv cannot resolve `$dynamicRef` outside the root document; it is the
same modification published by `@seriousme/openapi-schema-validator` (MIT), from which the 3.1 and 3.2 files were
first taken. The consequence is that Schema Objects inside a document are not validated by these files (the upstream
files do not do that either: they are the "without schema validation" variants).

The 3.0 file was upgraded from `2021-09-28` to `2024-10-18` after checking that all unit/integration tests and nine
large real-world documents (docs/real-world-results.md) give the same results.

SHA-256 of the files as committed:

| File                  | SHA-256                                                          |
| --------------------- | ---------------------------------------------------------------- |
| `oas-3.0.schema.json` | 058a2ac8e2225dc22aeb263aba7aac0f8f1c2f62bbc6f4999c0a52be9b5de50c |
| `oas-3.1.schema.json` | bc45e3cc4525e0f7ae021f2abc257d6c68abaaf59a3a90041de890c21983e4b7 |
| `oas-3.2.schema.json` | 113a4898cd9b6ff22c55aa0e705419f904ac026fa3ee8dc89ddbf1b0be3795b9 |

## Refreshing

Copy the newer `oas/3.x/schema/<date>` file from the repository above, re-apply the `$dynamicRef` replacement for
3.1/3.2, update the table and hashes, and run the full test suite and `scripts/real-world.mjs`.
