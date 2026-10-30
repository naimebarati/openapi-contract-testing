# ADR-0004: readOnly / writeOnly and discriminator

Status: accepted (Phase 0)

## readOnly / writeOnly

Validation is always in *response* direction.

* `readOnly` properties behave normally (they may be required in responses).
* `writeOnly` properties are removed from `required`, including when:
  the property schema is a `$ref` to a `writeOnly` schema, or `required` and `properties` are split across `allOf`
  members (members that are `$ref`s are transformed once per distinct set of inherited `writeOnly` names).
* If a `writeOnly` property is **present** in a response, policy `writeOnlyInResponse` applies:
  `'error'` (default; OAS says it SHOULD NOT be sent and this is typically a data leak), `'warning'`, `'ignore'`.
  Implemented by replacing the property schema with a custom always-failing keyword, so the rest of the schema is
  untouched. Properties are never deleted from the schema.
* Known limitation (documented): `required`/`properties` split across `oneOf`/`anyOf`/`if` branches are not
  correlated.

## discriminator

Plain `oneOf` fails when a payload matches several variants, which is common with a discriminator because the
variants are often not mutually exclusive structurally. The spike shows a Cat/Dog payload failing plain `oneOf`
and passing with dispatch.

* When `discriminator` is present with `oneOf`/`anyOf`, validation dispatches on the discriminator property:
  explicit `mapping` first, then the implicit component schema name of `$ref` variants. The property is required;
  an unmapped value is an error; the selected variant is validated (errors reference only that variant).
* If no mapping can be resolved (inline variants without mapping), the schema falls back to plain `oneOf`/`anyOf`
  and a `spec.unsupported_feature` warning is emitted.
* Ajv's own `discriminator: true` mode is not used: it throws at compile time for common specs (variants without
  `const`/`enum` on the discriminator property) and ignores `mapping`.
