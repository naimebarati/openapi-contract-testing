import type { LoadDiagnostics } from '../diagnostics/load-diagnostics.js';
import { OpenApiSpecError } from '../diagnostics/errors.js';
import { createIssue } from '../diagnostics/issue-factory.js';
import type { DocLocation, ReferenceResolver } from '../loader/reference-resolver.js';
import type { WriteOnlyInResponsePolicy } from '../public-types.js';
import type { SchemaDialectAdapter } from './dialects/index.js';
import {
  ANNOTATION_ONLY_KEYWORDS,
  LAZY_REF_KEYWORD,
  WRITE_ONLY_KEYWORD,
} from './dialects/schema-dialect-adapter.js';

type Obj = Record<string, unknown>;

export const REGISTRY_URI = 'urn:oct:registry';
const MAX_REF_DEPTH = 32;
/** Keywords that would change how references resolve; v1 does not implement them. */
const REFERENCE_KEYWORDS = [
  '$id',
  '$anchor',
  '$dynamicRef',
  '$dynamicAnchor',
  '$recursiveRef',
  '$recursiveAnchor',
  '$vocabulary',
];

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const pointerSegment = (value: string): string => value.replace(/~/g, '~0').replace(/\//g, '~1');
const locKey = (loc: DocLocation): string => `${loc.docKey}#${loc.pointer}`;

interface TransformContext {
  /** Registry definition that is currently being built (the source of any `$ref` it emits). */
  owner: string;
  /** writeOnly property names declared by sibling `allOf` members. */
  inherited: ReadonlySet<string>;
}

/** A `$ref` that was written into a definition; it may later be turned into a lazy reference. */
export interface RefSite {
  node: Obj;
  owner: string;
  target: string;
  ref: string;
}

export interface TransformerOptions {
  writeOnlyInResponse: WriteOnlyInResponsePolicy;
  validateFormats: boolean;
  isKnownFormat: (format: string) => boolean;
}

/**
 * Turns Schema Objects into dialect-correct JSON Schema stored in one registry (ADR-0002/0003/0004).
 *
 * - `$ref` targets become registry entries; Ajv resolves cycles and `$ref` siblings natively.
 * - Keywords are interpreted by position, so a property *named* `nullable` or `x-foo` stays a property.
 * - Unknown keywords are reported, never dropped silently.
 * - Validation is response-direction: writeOnly properties are not required, and are errors when present
 *   (policy `writeOnlyInResponse`).
 * - A `discriminator` on oneOf/anyOf selects the variant by the property value.
 * Input documents are only read.
 */
export class SchemaRegistry {
  readonly definitions: Record<string, unknown> = {};
  /** Where each definition came from, for diagnostics. */
  readonly origins = new Map<string, DocLocation>();
  readonly unknownFormats = new Set<string>();
  readonly sites: RefSite[] = [];
  /** Transformed schema node -> where it was written in the contract. Used to locate validation errors. */
  readonly nodeOrigins = new WeakMap<object, { loc: DocLocation; synthetic: boolean }>();
  private readonly ids = new Map<string, string>();
  private entryCount = 0;

  constructor(
    private readonly resolver: ReferenceResolver,
    private readonly adapter: SchemaDialectAdapter,
    private readonly diagnostics: LoadDiagnostics,
    private readonly options: TransformerOptions,
  ) {}

  /** Registers a schema used directly by the contract (response body, header). Returns its `$ref`. */
  async addEntry(node: unknown, loc: DocLocation): Promise<string> {
    const id = `e${this.entryCount++}`;
    this.definitions[id] = true; // reserve
    this.origins.set(id, loc);
    this.definitions[id] = await this.transform(node, loc, { owner: id, inherited: new Set() });
    return `${REGISTRY_URI}#/definitions/${id}`;
  }

  private async refTo(
    target: DocLocation,
    inherited: ReadonlySet<string>,
  ): Promise<{ ref: string; id: string }> {
    // $ref members of an allOf are transformed once per distinct set of inherited writeOnly names.
    const key = `${locKey(target)}${inherited.size > 0 ? `|${[...inherited].sort().join(',')}` : ''}`;
    let id = this.ids.get(key);
    if (id === undefined) {
      id = `s${this.ids.size}`;
      this.ids.set(key, id);
      this.origins.set(id, target);
      this.definitions[id] = true; // breaks reference cycles
      this.definitions[id] = await this.transform(this.resolver.get(target), target, {
        owner: id,
        inherited,
      });
    }
    return { ref: `${REGISTRY_URI}#/definitions/${id}`, id };
  }

  /** Writes a `$ref` into `node` and records it so the linker can find cycle-closing references. */
  private async link(
    node: Obj,
    owner: string,
    target: DocLocation,
    inherited: ReadonlySet<string>,
  ): Promise<void> {
    const { ref, id } = await this.refTo(target, inherited);
    node['$ref'] = ref;
    this.sites.push({ node, owner, target: id, ref });
  }

  /** Follows `$ref` chains to the schema they point at (used to read `writeOnly`, `type`). */
  async peek(node: unknown, loc: DocLocation): Promise<{ node: unknown; loc: DocLocation }> {
    let current = node;
    let at = loc;
    for (
      let depth = 0;
      depth < MAX_REF_DEPTH && isObj(current) && typeof current['$ref'] === 'string';
      depth++
    ) {
      at = await this.resolver.resolve(at.docKey, current['$ref']);
      current = this.resolver.get(at);
    }
    return { node: current, loc: at };
  }

  private where(loc: DocLocation): string {
    return `${this.resolver.label(loc.docKey)}#${loc.pointer}`;
  }

  private unsupported(message: string, loc: DocLocation): void {
    this.diagnostics.reportUnsupported(`${message} (${this.where(loc)})`, {
      schemaPath: loc.pointer,
    });
  }

  private async writeOnlyNames(
    node: unknown,
    loc: DocLocation,
    seen = new Set<unknown>(),
    depth = 0,
  ): Promise<Set<string>> {
    const names = new Set<string>();
    if (depth > 10) return names;
    const peeked = await this.peek(node, loc);
    const schema = peeked.node;
    if (!isObj(schema) || seen.has(schema)) return names;
    seen.add(schema);
    if (isObj(schema['properties'])) {
      for (const [name, property] of Object.entries(schema['properties'])) {
        const propertyLoc = {
          docKey: peeked.loc.docKey,
          pointer: `${peeked.loc.pointer}/properties/${pointerSegment(name)}`,
        };
        const target = await this.peek(property, propertyLoc);
        if (isObj(target.node) && target.node['writeOnly'] === true) names.add(name);
      }
    }
    if (Array.isArray(schema['allOf'])) {
      for (const [index, member] of (schema['allOf'] as unknown[]).entries()) {
        const memberLoc = {
          docKey: peeked.loc.docKey,
          pointer: `${peeked.loc.pointer}/allOf/${index}`,
        };
        for (const name of await this.writeOnlyNames(member, memberLoc, seen, depth + 1))
          names.add(name);
      }
    }
    return names;
  }

  private async transform(
    node: unknown,
    loc: DocLocation,
    ctx: TransformContext,
  ): Promise<unknown> {
    const inherited = ctx.inherited;
    if (typeof node === 'boolean') {
      if (!this.adapter.booleanSchemas) {
        throw invalid(
          `Boolean schemas are not valid in OpenAPI ${this.adapter.version} (${this.where(loc)}).`,
          loc,
        );
      }
      return node;
    }
    if (!isObj(node)) throw invalid(`A Schema Object must be an object (${this.where(loc)}).`, loc);

    const out: Obj = {};
    if (typeof node['$ref'] === 'string') {
      await this.link(
        out,
        ctx.owner,
        await this.resolver.resolve(loc.docKey, node['$ref']),
        inherited,
      );
      if (!this.adapter.refSiblingsApply) {
        // OAS 3.0: everything next to $ref is ignored by definition. Say so instead of hiding it.
        const ignored = Object.keys(node).filter(
          (k) => k !== '$ref' && !k.startsWith('x-') && k !== 'description',
        );
        if (ignored.length > 0) {
          this.diagnostics.reportWarning(
            'spec.unsupported_feature',
            `Keywords next to $ref are ignored in OpenAPI 3.0: ${ignored.join(', ')} (${this.where(loc)})`,
            { schemaPath: loc.pointer },
          );
        }
        return out;
      }
    }

    for (const keyword of REFERENCE_KEYWORDS) {
      if (keyword in node) this.unsupported(`Schema keyword "${keyword}" is not supported`, loc);
    }

    const needsHidden = 'required' in node || 'properties' in node || 'allOf' in node;
    const hidden = new Set<string>(inherited);
    if (needsHidden) for (const name of await this.writeOnlyNames(node, loc)) hidden.add(name);

    for (const [keyword, value] of Object.entries(node)) {
      const at = { docKey: loc.docKey, pointer: `${loc.pointer}/${pointerSegment(keyword)}` };
      if (
        keyword === '$ref' ||
        keyword === '$comment' ||
        keyword === 'discriminator' ||
        keyword.startsWith('x-')
      )
        continue;
      if (REFERENCE_KEYWORDS.includes(keyword)) continue;
      if (keyword === '$schema') {
        this.unsupported('"$schema" inside a Schema Object is not supported', loc);
      } else if (keyword === 'nullable') {
        if (this.adapter.version !== '3.0') {
          this.unsupported(
            '"nullable" is not a keyword in OpenAPI 3.1+; use type: [T, "null"]',
            loc,
          );
        }
      } else if (this.adapter.schemaKeywords.has(keyword)) {
        // `additionalProperties: true|false` is valid in every dialect; other boolean schemas need 2020-12.
        const booleanAllowed = this.adapter.booleanSchemas || keyword === 'additionalProperties';
        out[keyword] =
          typeof value === 'boolean' && booleanAllowed
            ? value
            : await this.transform(value, at, { owner: ctx.owner, inherited: new Set() });
      } else if (this.adapter.schemaArrayKeywords.has(keyword)) {
        if (!Array.isArray(value))
          throw invalid(`"${keyword}" must be an array (${this.where(at)}).`, at);
        const members: unknown[] = [];
        for (const [index, member] of (value as unknown[]).entries()) {
          members.push(
            await this.transform(
              member,
              { docKey: at.docKey, pointer: `${at.pointer}/${index}` },
              { owner: ctx.owner, inherited: keyword === 'allOf' ? hidden : new Set() },
            ),
          );
        }
        out[keyword] = members;
      } else if (this.adapter.schemaMapKeywords.has(keyword)) {
        if (!isObj(value)) throw invalid(`"${keyword}" must be an object (${this.where(at)}).`, at);
        const map: Obj = {};
        for (const [name, child] of Object.entries(value)) {
          if (
            keyword === 'properties' &&
            hidden.has(name) &&
            this.options.writeOnlyInResponse !== 'ignore'
          ) {
            const marker: Obj = { [WRITE_ONLY_KEYWORD]: true };
            this.nodeOrigins.set(marker, {
              loc: { docKey: at.docKey, pointer: `${at.pointer}/${pointerSegment(name)}` },
              synthetic: true,
            });
            map[name] = marker;
          } else {
            map[name] = await this.transform(
              child,
              { docKey: at.docKey, pointer: `${at.pointer}/${pointerSegment(name)}` },
              { owner: ctx.owner, inherited: new Set() },
            );
          }
        }
        out[keyword] = map;
      } else if (keyword === 'required') {
        if (!Array.isArray(value))
          throw invalid(`"required" must be an array (${this.where(at)}).`, at);
        const required = (value as unknown[]).filter(
          (name) => typeof name !== 'string' || !hidden.has(name),
        );
        // draft-04 forbids an empty "required"; it also means nothing, so it is dropped.
        if (required.length > 0 || this.adapter.version !== '3.0') out[keyword] = required;
      } else if (ANNOTATION_ONLY_KEYWORDS.has(keyword)) {
        // Accepted but dropped: no effect on validation (see ANNOTATION_ONLY_KEYWORDS).
      } else if (this.adapter.plainKeywords.has(keyword)) {
        out[keyword] = value;
        if (keyword === 'format') this.noteFormat(value, loc);
      } else {
        this.unsupported(`Unsupported schema keyword "${keyword}"`, loc);
      }
    }

    if (
      this.adapter.version === '3.0' &&
      node['nullable'] === true &&
      typeof out['type'] === 'string'
    ) {
      // OAS 3.0.3: nullable only extends `type`; enum/const still apply, so enum must list null itself.
      out['type'] = [out['type'], 'null'];
    }
    if (node['discriminator'] !== undefined) await this.discriminate(node, out, loc, ctx.owner);
    this.nodeOrigins.set(out, { loc, synthetic: false });
    return out;
  }

  /**
   * Ajv compiles `$ref` targets recursively, so long reference chains overflow the call stack (a ring
   * of ~300 schemas is enough). Fix: find the cycle-closing references (DFS back edges), turn those into
   * lazy references, and report definitions in post-order so every remaining native `$ref` points at an
   * already compiled definition. Returns the compile order. See ADR-0003.
   */
  linkAndOrder(): string[] {
    const edges = new Map<string, RefSite[]>();
    for (const site of this.sites) {
      const list = edges.get(site.owner) ?? [];
      list.push(site);
      edges.set(site.owner, list);
    }
    const state = new Map<string, 'active' | 'done'>();
    const order: string[] = [];
    const roots = Object.keys(this.definitions);
    for (const root of roots) {
      if (state.has(root)) continue;
      const stack: { id: string; next: number }[] = [{ id: root, next: 0 }];
      state.set(root, 'active');
      while (stack.length > 0) {
        const frame = stack[stack.length - 1] as { id: string; next: number };
        const outgoing = edges.get(frame.id) ?? [];
        const site = outgoing[frame.next++];
        if (site === undefined) {
          state.set(frame.id, 'done');
          order.push(frame.id);
          stack.pop();
          continue;
        }
        const seen = state.get(site.target);
        if (seen === 'active') {
          delete site.node['$ref'];
          site.node[LAZY_REF_KEYWORD] = site.ref;
        } else if (seen === undefined) {
          state.set(site.target, 'active');
          stack.push({ id: site.target, next: 0 });
        }
      }
    }
    return order;
  }

  private noteFormat(format: unknown, loc: DocLocation): void {
    if (
      !this.options.validateFormats ||
      typeof format !== 'string' ||
      this.options.isKnownFormat(format)
    )
      return;
    if (this.unknownFormats.has(format)) return;
    this.unknownFormats.add(format);
    this.diagnostics.reportWarning(
      'spec.unsupported_feature',
      `Format "${format}" is not known and is treated as an annotation only. Register it in validation.customFormats to enforce it. (${this.where(loc)})`,
      { schemaPath: loc.pointer },
    );
  }

  /** OAS discriminator: validate against the variant selected by the property value (ADR-0004). */
  private async discriminate(node: Obj, out: Obj, loc: DocLocation, owner: string): Promise<void> {
    const discriminator = node['discriminator'];
    const property = isObj(discriminator) ? discriminator['propertyName'] : undefined;
    if (typeof property !== 'string') {
      this.unsupported('discriminator.propertyName must be a string', loc);
      return;
    }
    const kind = Array.isArray(node['oneOf'])
      ? 'oneOf'
      : Array.isArray(node['anyOf'])
        ? 'anyOf'
        : undefined;
    if (kind === undefined) {
      this.diagnostics.reportWarning(
        'spec.unsupported_feature',
        `discriminator without oneOf/anyOf is treated as an annotation; the payload is validated against this schema only (${this.where(loc)})`,
        { schemaPath: loc.pointer },
      );
      return;
    }
    const fallback = (reason: string): undefined => {
      this.diagnostics.reportWarning(
        'spec.unsupported_feature',
        `discriminator ${reason}; falling back to plain ${kind} semantics (${this.where(loc)})`,
        { schemaPath: loc.pointer },
      );
      return undefined;
    };

    const variants = node[kind] as unknown[];
    const variantKeys: (string | undefined)[] = [];
    for (const variant of variants) {
      variantKeys.push(
        isObj(variant) && typeof variant['$ref'] === 'string'
          ? locKey(await this.resolver.resolve(loc.docKey, variant['$ref']))
          : undefined,
      );
    }

    const mapping = new Map<string, number>();
    const explicit =
      isObj(discriminator) && isObj(discriminator['mapping']) ? discriminator['mapping'] : {};
    for (const [value, target] of Object.entries(explicit)) {
      if (typeof target !== 'string') {
        fallback(`mapping "${value}" is not a string`);
        return;
      }
      const ref = /[/#.]/.test(target) ? target : `#/components/schemas/${target}`;
      let index: number;
      try {
        index = variantKeys.indexOf(locKey(await this.resolver.resolve(loc.docKey, ref)));
      } catch {
        index = -1;
      }
      if (index < 0) {
        fallback(`mapping "${value}" does not point at a ${kind} member`);
        return;
      }
      mapping.set(value, index);
    }
    variants.forEach((variant, index) => {
      const ref = isObj(variant) ? variant['$ref'] : undefined;
      if (typeof ref === 'string' && ref.includes('/components/schemas/')) {
        const name = decodeURIComponent(ref.slice(ref.lastIndexOf('/') + 1));
        if (!mapping.has(name)) mapping.set(name, index);
      }
    });
    const mapped = new Set(mapping.values());
    if (variants.some((_, index) => !mapped.has(index))) {
      fallback(
        'has members that cannot be mapped to a discriminator value (inline schemas without mapping)',
      );
      return;
    }

    const defaultMapping =
      this.adapter.version === '3.2' &&
      isObj(discriminator) &&
      typeof discriminator['defaultMapping'] === 'string'
        ? discriminator['defaultMapping']
        : undefined;

    Reflect.deleteProperty(out, kind);
    const guard: Obj[] = [];
    const values = [...mapping.keys()];
    for (const [value, index] of mapping) {
      guard.push({
        if: { properties: { [property]: { const: value } }, required: [property] },
        then: await this.transform(
          variants[index],
          { docKey: loc.docKey, pointer: `${loc.pointer}/${kind}/${index}` },
          { owner, inherited: new Set() },
        ),
      });
    }
    if (defaultMapping !== undefined) {
      const target = await this.resolver.resolve(
        loc.docKey,
        /[/#.]/.test(defaultMapping) ? defaultMapping : `#/components/schemas/${defaultMapping}`,
      );
      const then: Obj = {};
      await this.link(then, owner, target, new Set());
      guard.push({
        if: { properties: { [property]: { not: { enum: values } } } },
        then,
      });
    }
    const discriminatorLoc = { docKey: loc.docKey, pointer: `${loc.pointer}/discriminator` };
    // The generated `if`/enum/required guards belong to the discriminator; `then`/`else` hold real variants.
    const markSynthetic = (value: unknown): void => {
      if (!isObj(value)) return;
      this.nodeOrigins.set(value, { loc: discriminatorLoc, synthetic: true });
      for (const [key, child] of Object.entries(value)) {
        if (key !== 'then' && key !== 'else') markSynthetic(child);
      }
    };
    guard.forEach(markSynthetic);

    // A discriminator names a *property*, so it can only select a variant for objects. Any other value
    // (for example the array variant of GitHub's content API) is checked with plain oneOf/anyOf semantics;
    // without this split, `required`/`properties` pass vacuously on arrays and every `then` branch would apply.
    const plain: unknown[] = [];
    for (const [index, variant] of variants.entries()) {
      plain.push(
        await this.transform(
          variant,
          { docKey: loc.docKey, pointer: `${loc.pointer}/${kind}/${index}` },
          { owner, inherited: new Set() },
        ),
      );
    }
    // Dispatch only when the value names a variant (or a defaultMapping exists). Real documents often declare a
    // discriminator whose values are not the schema names (OpenAI: `type: message` vs schema `Message`); an
    // unmapped value must then fall back to plain oneOf/anyOf instead of rejecting a valid response.
    const selector: Obj =
      defaultMapping === undefined
        ? { type: 'object', required: [property], properties: { [property]: { enum: values } } }
        : { type: 'object', required: [property] };
    const split: Obj = { if: selector, then: { allOf: guard }, else: { [kind]: plain } };
    markSynthetic(selector);
    this.nodeOrigins.set(split, { loc: discriminatorLoc, synthetic: true });
    this.nodeOrigins.set(split['then'] as object, { loc: discriminatorLoc, synthetic: true });
    this.nodeOrigins.set(split['else'] as object, { loc: discriminatorLoc, synthetic: true });
    const existing = Array.isArray(out['allOf']) ? (out['allOf'] as unknown[]) : [];
    out['allOf'] = [...existing, split];
  }
}

function invalid(message: string, loc: DocLocation): OpenApiSpecError {
  return new OpenApiSpecError(message, [
    createIssue('spec.invalid', message, { schemaPath: loc.pointer }),
  ]);
}
