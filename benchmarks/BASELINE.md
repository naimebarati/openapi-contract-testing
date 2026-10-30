# Benchmark baseline

`npm run build && npm run bench` loads a generated OpenAPI 3.1 document with **1000 operations** (500 paths x
GET/PUT, 100 cyclic shared schemas, one required header, a 200 and a 404 response each), then runs **10,000
validations** over the operations (valid JSON bodies with a nested, cyclic structure) and 1,000 validations of
an invalid response.

Recorded on the development container (shared CPU, so use these as orders of magnitude, not guarantees):

| Node    | load + compile | validations / s | 1000 invalid responses |
| ------- | -------------: | --------------: | ---------------------: |
| 22.22.0 |         ~2.5 s |         ~19,000 |                 ~40 ms |
| 24.22.2 |         ~2.3 s |         ~19,700 |                 ~36 ms |
| 26.13.0 |         ~2.2 s |         ~20,500 |                 ~35 ms |

- Loading is dominated by compiling about 3,000 distinct schemas (about 0.8 ms each); it happens once per contract.
  Schemas shared through `$ref` are compiled once.
- Route lookup does not scan paths: static routes are a hash lookup, templated routes are bucketed.
- The benchmark is not a CI gate. CI uploads the numbers of each run as an artifact.
