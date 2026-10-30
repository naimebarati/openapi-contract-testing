import type { NormalizedResponse, NormalizedResponses } from '../normalize/model.js';

/** OpenAPI precedence: exact status, then `NXX` range, then `default`. */
export function selectResponse(
  responses: NormalizedResponses,
  status: number,
): NormalizedResponse | undefined {
  return (
    responses.exact.get(status) ??
    responses.ranges.get(Math.floor(status / 100)) ??
    responses.default
  );
}
