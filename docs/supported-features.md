# Supported features

What the package validates, what it reports and what it does not do. Every row marked "reported" produces an
issue (`spec.unsupported_feature` or `response.body_validation_unsupported`); nothing is dropped silently.
Statements here are backed by tests in `tests/unit`, `tests/integration` and `tests/security`.

## Documents

| Feature                                                                     | Status                                                                                 |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| OpenAPI 3.0.x, 3.1.x, 3.2.x                                                 | Supported. Structure validated with the official OpenAPI JSON Schemas (vendored).      |
| Swagger / OpenAPI 2.0, 4.x                                                  | Rejected with a specific message.                                                      |
| YAML 1.2 and JSON, `document` objects, raw `content`                        | Supported. YAML merge keys (`<<`) are not expanded. Duplicate YAML keys are an error.  |
| `jsonSchemaDialect`                                                         | The OpenAPI dialect and JSON Schema 2020-12 are accepted; any other value is reported. |
| `$self` (3.2)                                                               | Reported: relative references resolve against the file location, not `$self`.          |
| `webhooks`, `callbacks`, `links`, `security`, request bodies and parameters | Not validated (response contracts only).                                               |

## References

| Feature                                                              | Status                                                                                                                             |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `#/...` JSON Pointer references                                      | Supported, including to non-schema objects (responses, headers, path items, media types).                                          |
| Relative file references (`./a.yaml#/x`)                             | Supported inside the root directory. Each file is loaded once.                                                                     |
| Cycles                                                               | Supported for schemas. A cycle of non-schema Reference Objects is an error.                                                        |
| `http(s):`, `file:` and other URL schemes                            | Refused (`reference.not_allowed`). Remote references are not implemented.                                                          |
| Anchors (`#name`), `$id`, `$anchor`, `$dynamicRef`, `$dynamicAnchor` | Reported.                                                                                                                          |
| `$ref` siblings                                                      | 3.1/3.2: applied together with the target (JSON Schema 2020-12). 3.0: ignored as the specification says, and a warning lists them. |

## Routing

| Feature                                                                                              | Status                                                                                            |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Method + path template, case-sensitive paths                                                         | Supported. Methods are upper-cased; `HEAD`/`OPTIONS`/`QUERY` are never turned into `GET`.         |
| Templates mixing text and parameters (`/files/{name}.{ext}`)                                         | Supported.                                                                                        |
| Static segments before parameters; fallback to a templated path when the static one lacks the method | Supported. Overlapping templates that are not strictly ordered give `operation.ambiguous`.        |
| Paths that differ only by parameter names                                                            | `spec.path_collision` at load time.                                                               |
| `trailingSlash: 'strict' \| 'ignore'`                                                                | Supported (default strict).                                                                       |
| `%2F` and other percent-encoding                                                                     | Segments are split before decoding; malformed encoding is `request.invalid_url`.                  |
| `servers` at root, path item and operation level (replace, not merge)                                | Supported; the host is not compared. Variables in the path use their `enum` values, or `default`. |
| `routing.basePath`, `routing.baseUrl`, `routing.serverIndex`                                         | Supported. No prefix is ever guessed.                                                             |
| `QUERY` method and `additionalOperations` (3.2)                                                      | Supported.                                                                                        |

## Responses

| Feature                                                                          | Status                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status resolution exact > `NXX` > `default`                                      | Supported.                                                                                                                                                                                                                     |
| HEAD, 1xx, 204, 205, 304                                                         | No body validation; a received body is `response.body_unexpected`. HEAD still checks headers and a sent Content-Type.                                                                                                          |
| Response headers: required, optional, schema                                     | Supported for string, integer, number, boolean and arrays of those (simple style). Repeated lines are joined with `, ` except `Set-Cookie`. Headers named `Content-Type` in the contract are ignored in favour of media types. |
| Headers with object schemas, union types, composition, or defined with `content` | Reported at load; presence is still checked.                                                                                                                                                                                   |
| Header values in results                                                         | Never shown unless `includeActualValues`; sensitive names stay `[redacted]`.                                                                                                                                                   |
| Media type selection                                                             | Exact, then `type/*`, then `*/*`; contract parameters must match; `+json` types are not `application/json`.                                                                                                                    |
| JSON bodies (`application/json`, `*+json`)                                       | Parsed (raw) or taken as already parsed (`body`); BOM stripped; syntax errors do not echo the payload.                                                                                                                         |
| `text/*` bodies                                                                  | String schemas; `integer`/`number`/`boolean` schemas parse the text strictly; array/object schemas are reported.                                                                                                               |
| XML, HTML, binary, multipart, form-encoded, streams                              | Content-Type and presence only; warning `response.body_validation_unsupported`.                                                                                                                                                |
| `itemSchema` (3.2 streaming/sequential media types)                              | Reported at load.                                                                                                                                                                                                              |
| Body size                                                                        | `maxBodyBytes` applies to raw payloads; the Fetch adapter never reads more than `maxBodyBytes + 1` bytes.                                                                                                                      |

## Schemas

| Feature                                                                                                  | OpenAPI 3.0 (JSON Schema draft-04 based)                                                                                                                    | OpenAPI 3.1 / 3.2 (JSON Schema 2020-12)           |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `type`, `enum`, `required`, `properties`, `additionalProperties`, `items`, `allOf`/`anyOf`/`oneOf`/`not` | Yes                                                                                                                                                         | Yes                                               |
| String/number/array/object constraints, `pattern`                                                        | Yes                                                                                                                                                         | Yes                                               |
| `nullable`                                                                                               | Yes: adds `null` to `type` only when `type` is set; `enum` must list `null` itself (3.0.3 rule)                                                             | Not a keyword; reported (use `type: [T, 'null']`) |
| `exclusiveMinimum` / `exclusiveMaximum`                                                                  | Boolean form                                                                                                                                                | Numeric form; the boolean form fails at load      |
| `const`, `prefixItems`, `if/then/else`, `dependentRequired`, `unevaluated*`, boolean schemas             | Not in 3.0 (rejected by the document schema)                                                                                                                | Yes                                               |
| `format`                                                                                                 | Standard formats via `ajv-formats`; unknown formats are warned about and treated as annotations; `customFormats` for your own                               | Same                                              |
| `readOnly`                                                                                               | Normal in responses                                                                                                                                         | Same                                              |
| `writeOnly`                                                                                              | Not required in responses; present = error/warning/ignored by `writeOnlyInResponse`                                                                         | Same                                              |
| `discriminator` + `oneOf`/`anyOf`                                                                        | Variant chosen by property (explicit `mapping`, then schema name); unknown value is an error. Unmappable members fall back to plain `oneOf` with a warning. | Same; `defaultMapping` in 3.2                     |
| `discriminator` without `oneOf`/`anyOf`                                                                  | Annotation only, with a warning                                                                                                                             | Same                                              |
| `example`, `examples`, `xml`, `externalDocs`, `deprecated`, `title`, `description`, `x-*`                | Accepted, not asserted                                                                                                                                      | Same                                              |
| Unknown keywords                                                                                         | Reported                                                                                                                                                    | Reported                                          |

Known limitation: a reference that closes a cycle is resolved lazily, so `unevaluatedProperties` /
`unevaluatedItems` do not see annotations across that single reference (ADR-0003, addendum).

## Not in this version

Request validation, Swagger 2.0, remote references and URL sources, XML validation, header objects,
`itemSchema`, GraphQL/AsyncAPI, breaking-change detection, contract coverage reports. See the roadmap in the
design notes; none of these is implied by this package.
