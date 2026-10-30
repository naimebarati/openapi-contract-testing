# Vendored OpenAPI document schemas

`oas-3.0.schema.json`, `oas-3.1.schema.json`, `oas-3.2.schema.json` validate the _structure_ of an OpenAPI
document (Schema Object contents are validated later, when schemas are compiled; see ADR-0001/0003).

Origin: the schemas of the OpenAPI Initiative (https://github.com/OAI/OpenAPI-Specification), in the form
redistributed by `@seriousme/openapi-schema-validator@2.11.0` (MIT), which replaces `$dynamicRef` with plain
`$ref` so that Ajv can compile them. They are copied unchanged from that package.

| File                  | SHA-256                                                          |
| --------------------- | ---------------------------------------------------------------- |
| `oas-3.0.schema.json` | 7a0db7311a69d8b7f2505f59c5d4cbb58539a0961df0c05724a07538014822cf |
| `oas-3.1.schema.json` | ac6ec6fe9d9d0cc380f16bf0ad123f90dc5b925772624c07f678421db171768d |
| `oas-3.2.schema.json` | ca7ae8979841f44e23efa95e04a71f5e086492ed249bfaea2c2339e70c2bd64e |

To refresh: install the newer `@seriousme/openapi-schema-validator`, copy `schemas/v3.x/schema.json`, update the
hashes above, and run the fixture tests in `tests/unit/loader`.
