import type { NormalizedOperation } from '../normalize/model.js';
import { parsePathTemplate, segmentMatches, splitPath } from './path-template.js';
import type { ParsedTemplate } from './path-template.js';

export interface Route {
  operation: NormalizedOperation;
  /** Server path prefix this route was registered under. */
  prefix: string;
  template: ParsedTemplate;
}

export type LookupResult =
  | { kind: 'found'; route: Route }
  | { kind: 'ambiguous'; routes: Route[] }
  | { kind: 'invalid_path'; reason: string }
  | {
      kind: 'not_found';
      /** Methods documented for this path (empty when the path itself is unknown). */
      documentedMethods: string[];
      /** Diagnostic hint only, never used for matching. */
      hint: string | undefined;
    };

interface MethodTable {
  statics: Map<string, Route[]>;
  dynamic: Map<string, Route[]>;
}

const SEP = '\u0000';

/**
 * Method + path lookup without scanning every path per request: fully static routes are a hash lookup,
 * templated routes are bucketed by segment count and first static segment.
 */
export class OperationIndex {
  private readonly tables = new Map<string, MethodTable>();
  private readonly trailingSlash: 'strict' | 'ignore';

  /**
   * @param onCollision called once per pair of paths that differ only in parameter names (or, with
   *   `trailingSlash: 'ignore'`, a trailing slash). OpenAPI forbids them, but real documents contain them, so
   *   loading continues: such paths are only ambiguous for the methods they share (`operation.ambiguous`).
   */
  constructor(
    operations: readonly NormalizedOperation[],
    trailingSlash: 'strict' | 'ignore',
    onCollision: (message: string, pathTemplate: string) => void = () => undefined,
  ) {
    this.trailingSlash = trailingSlash;
    const owners = new Map<string, string>();
    const reported = new Set<string>();
    for (const operation of operations) {
      for (const prefix of operation.prefixes) {
        const full = this.normalizeTemplatePath(`${prefix}${operation.path}`);
        const template = parsePathTemplate(full);
        const owner = owners.get(template.canonical);
        if (
          owner !== undefined &&
          owner !== operation.path &&
          !reported.has(`${owner}\0${operation.path}`)
        ) {
          reported.add(`${owner}\0${operation.path}`);
          onCollision(
            `Paths "${owner}" and "${operation.path}" are ambiguous: they only differ in parameter names${
              this.trailingSlash === 'ignore' ? ' or a trailing slash' : ''
            }. Requests that match both are reported as operation.ambiguous for the methods they share.`,
            operation.path,
          );
        } else if (owner === undefined) {
          owners.set(template.canonical, operation.path);
        }
        this.addRoute({ operation, prefix, template });
      }
    }
  }

  private normalizeTemplatePath(path: string): string {
    const withRoot = path === '' ? '/' : path;
    return this.trailingSlash === 'ignore' && withRoot.length > 1
      ? withRoot.replace(/\/+$/, '') || '/'
      : withRoot;
  }

  private addRoute(route: Route): void {
    const method = route.operation.method;
    let table = this.tables.get(method);
    if (!table) {
      table = { statics: new Map(), dynamic: new Map() };
      this.tables.set(method, table);
    }
    const { segments, staticCount } = route.template;
    if (staticCount === segments.length) {
      const key = segments.map((s) => s.literal).join(SEP);
      table.statics.set(key, [...(table.statics.get(key) ?? []), route]);
      return;
    }
    const key = bucketKey(segments.length, segments[0]?.rank === 2 ? segments[0].literal : '*');
    const bucket = table.dynamic.get(key) ?? [];
    bucket.push(route);
    bucket.sort(compareSpecificity);
    table.dynamic.set(key, bucket);
  }

  /** `path` is the percent-encoded pathname of the request. */
  lookup(method: string, path: string): LookupResult {
    const segments = this.decodeSegments(path);
    if (typeof segments === 'string') return { kind: 'invalid_path', reason: segments };
    const matches = this.matching(this.tables.get(method), segments);
    const [best, ...others] = matches;
    if (best === undefined) return this.notFound(segments);
    // Templates that differ only in parameter names cannot be told apart; neither can incomparable ones.
    if (
      others.some(
        (other) => other.template.canonical === best.template.canonical || !dominates(best, other),
      )
    ) {
      return { kind: 'ambiguous', routes: matches };
    }
    return { kind: 'found', route: best };
  }

  private decodeSegments(path: string): string[] | string {
    const normalized = this.normalizeTemplatePath(path);
    try {
      return splitPath(normalized).map((segment) => decodeURIComponent(segment));
    } catch {
      return 'the path contains malformed percent-encoding';
    }
  }

  private matching(table: MethodTable | undefined, segments: string[]): Route[] {
    if (!table) return [];
    const exact = table.statics.get(segments.join(SEP));
    if (exact) return exact;
    const first = segments[0] ?? '';
    const candidates = [
      ...(table.dynamic.get(bucketKey(segments.length, first)) ?? []),
      ...(table.dynamic.get(bucketKey(segments.length, '*')) ?? []),
    ];
    return candidates
      .filter((route) =>
        route.template.segments.every((segment, i) => segmentMatches(segment, segments[i] ?? '')),
      )
      .sort(compareSpecificity);
  }

  private notFound(segments: string[]): LookupResult {
    const documentedMethods = [...this.tables.entries()]
      .filter(([, table]) => this.matching(table, segments).length > 0)
      .map(([method]) => method)
      .sort();
    let hint: string | undefined;
    if (documentedMethods.length === 0) {
      for (let drop = 1; drop < Math.min(segments.length, 5) && hint === undefined; drop++) {
        const rest = segments.slice(drop);
        const hit = [...this.tables.values()].some(
          (table) => this.matching(table, rest).length > 0,
        );
        if (hit) {
          hint = `The path matches the contract once "/${segments
            .slice(0, drop)
            .join(
              '/',
            )}" is removed. If that is a server prefix, add it to the contract's "servers" or set "routing.basePath".`;
        }
      }
    }
    return { kind: 'not_found', documentedMethods, hint };
  }
}

function bucketKey(count: number, first: string): string {
  return `${count}${SEP}${first}`;
}

function compareSpecificity(a: Route, b: Route): number {
  if (a.template.staticCount !== b.template.staticCount)
    return b.template.staticCount - a.template.staticCount;
  for (let i = 0; i < a.template.segments.length; i++) {
    const diff = (b.template.segments[i]?.rank ?? 0) - (a.template.segments[i]?.rank ?? 0);
    if (diff !== 0) return diff;
  }
  return a.operation.path.localeCompare(b.operation.path);
}

/** `a` is at least as specific as `b` in every segment, so choosing `a` is unambiguous. */
function dominates(a: Route, b: Route): boolean {
  return a.template.segments.every(
    (segment, i) => segment.rank >= (b.template.segments[i]?.rank ?? 0),
  );
}
