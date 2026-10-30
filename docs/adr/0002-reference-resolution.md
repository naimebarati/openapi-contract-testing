# ADR-0002: Reference resolution and reference security

Status: accepted (Phase 0)

## Context

References appear in two different kinds of places: Reference Objects (path items, responses, headers,
parameters...) and Schema Object `$ref`s. Schema `$ref`s can be circular and, in OAS 3.1+, may carry sibling
keywords whose semantics must be preserved (ADR-0001, point 3).

## Decision

1. **Non-schema Reference Objects** are resolved by our code at load time (with cycle detection).
2. **Schema `$ref`s are not dereferenced.** Every referenced location `(file, JSON pointer)` becomes one entry
   in a per-contract *registry* (`definitions`), and the `$ref` is rewritten to point at that entry. Ajv then
   resolves cycles and `$ref` siblings natively. Prototype: `spikes/phase0/proto.mjs`, tests for circular refs
   within one file and across files pass on Node 22/24/26.
3. **External file references** (relative paths, resolved against the referencing file):
   * allowed only inside `rootDir` (default: directory of the entry file; for `document`/`content` inputs
     there is no default and file refs are rejected until `baseDir`/`refs.rootDir` is given);
   * confinement uses `realpath` of both root and target, so `..` traversal and symlink escapes are refused
     (tested with a symlink pointing outside the root);
   * `maxFiles`, `maxBytesPerFile` are enforced (size checked via `fstat` before reading);
   * failures are structured: `reference.not_allowed`, `reference.not_found`.
4. **`file:` / `http(s):` / any URL-scheme references are rejected** with `reference.not_allowed`.
5. **Remote references and URL sources are not implemented in v1.** A reliable SSRF defence (DNS rebinding,
   redirects, IPv6 forms, metadata endpoints) cannot be demonstrated within the scope of v1, and the brief says
   to leave remote refs out when that is the case. The `allowRemote` option from the brief is therefore *not*
   part of the v1 options type, and passing it at runtime throws a configuration error. Remote support can be
   added later behind the same resolver interface.
6. **Anchors** (`$ref: '#foo'`, `$anchor`, `$id`-based references, `$dynamicRef`) are reported as
   `spec.unsupported_feature`; they are never ignored silently.

## Consequences

* The registry gives us a single place to attach source locations for diagnostics (registry id -> file+pointer).
* `$id`-relative resolution is unsupported in v1 (documented in `docs/supported-features.md`).
