# Examples

## express-vitest

A small Express API tested against its OpenAPI document with Supertest and the Vitest matcher.

```bash
# from the repository root
npm install && npm run build

cd examples/express-vitest
npm install
npm test            # passes
npm run test:broken # the API drifts from the contract: shows the report you get when a response does not conform
```
