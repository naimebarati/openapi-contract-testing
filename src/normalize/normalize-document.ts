import type { ResolvedOptions } from '../contract/contract-options.js';
import { OpenApiConfigError, OpenApiSpecError } from '../diagnostics/errors.js';
import { createIssue } from '../diagnostics/issue-factory.js';
import type { LoadedDocument } from '../loader/load-document.js';
import type { DocLocation } from '../loader/reference-resolver.js';
import type {
  NormalizedDocument,
  NormalizedHeader,
  NormalizedMediaType,
  NormalizedOperation,
  NormalizedResponse,
  NormalizedResponses,
  SchemaSource,
} from './model.js';
import { normalizePrefix, serverPrefixes } from './normalize-servers.js';

type Obj = Record<string, unknown>;

const FIXED_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
  'query',
];
const MAX_REFERENCE_CHAIN = 32;
const EXACT_STATUS = /^[1-5]\d\d$/;
const RANGE_STATUS = /^([1-5])XX$/;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function encodePointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Builds the immutable normalized model from the loaded document: resolves Reference Objects outside
 * Schema Objects (path items, responses, headers, media types) and records where schemas live.
 * Schema `$ref`s are left alone; the schema compiler resolves them (ADR-0002).
 */
export async function normalizeDocument(
  doc: LoadedDocument,
  options: ResolvedOptions,
): Promise<NormalizedDocument> {
  const { resolver, diagnostics } = doc;
  const root = doc.root;

  async function deref(node: unknown, loc: DocLocation): Promise<{ node: Obj; loc: DocLocation }> {
    let current = node;
    let at = loc;
    const seen = new Set<string>();
    for (let depth = 0; depth < MAX_REFERENCE_CHAIN; depth++) {
      if (isObj(current) && typeof current['$ref'] === 'string') {
        const target = await resolver.resolve(at.docKey, current['$ref']);
        const key = `${target.docKey}#${target.pointer}`;
        if (seen.has(key)) {
          throw specInvalid(`Circular reference chain at ${describe(at)}.`, at);
        }
        seen.add(key);
        current = resolver.get(target);
        at = target;
        continue;
      }
      if (!isObj(current)) {
        throw specInvalid(`Expected an object at ${describe(at)}.`, at);
      }
      return { node: current, loc: at };
    }
    throw specInvalid(`Reference chain too long at ${describe(loc)}.`, loc);
  }

  const describe = (loc: DocLocation): string => `${resolver.label(loc.docKey)}#${loc.pointer}`;
  const specInvalid = (message: string, loc: DocLocation): OpenApiSpecError =>
    new OpenApiSpecError(message, [
      createIssue('spec.invalid', message, { schemaPath: loc.pointer }),
    ]);
  const unsupported = (message: string, loc: DocLocation): void => {
    diagnostics.reportUnsupported(`${message} (${describe(loc)})`, { schemaPath: loc.pointer });
  };

  async function normalizeHeaders(headers: unknown, loc: DocLocation): Promise<NormalizedHeader[]> {
    if (headers === undefined) return [];
    if (!isObj(headers)) throw specInvalid(`"headers" must be an object at ${describe(loc)}.`, loc);
    const result: NormalizedHeader[] = [];
    for (const [name, raw] of Object.entries(headers)) {
      // OpenAPI: a response header named Content-Type SHALL be ignored (it is handled by media types).
      if (name.toLowerCase() === 'content-type') continue;
      const headerLoc = { docKey: loc.docKey, pointer: `${loc.pointer}/${encodePointer(name)}` };
      const { node, loc: resolved } = await deref(raw, headerLoc);
      if (node['content'] !== undefined) {
        unsupported(`Header "${name}" is defined with "content", which is not supported`, resolved);
      }
      const style = node['style'];
      if (style !== undefined && style !== 'simple') {
        unsupported(
          `Header "${name}" uses style "${typeof style === 'string' ? style : typeof style}"; only "simple" exists for headers`,
          resolved,
        );
      }
      const schema: SchemaSource | undefined =
        node['schema'] === undefined
          ? undefined
          : {
              node: node['schema'],
              loc: { docKey: resolved.docKey, pointer: `${resolved.pointer}/schema` },
            };
      result.push({ name, required: node['required'] === true, schema, loc: resolved });
    }
    return result;
  }

  async function normalizeContent(
    content: unknown,
    loc: DocLocation,
  ): Promise<NormalizedMediaType[]> {
    if (content === undefined) return [];
    if (!isObj(content)) throw specInvalid(`"content" must be an object at ${describe(loc)}.`, loc);
    const result: NormalizedMediaType[] = [];
    for (const [key, raw] of Object.entries(content)) {
      const mediaLoc = { docKey: loc.docKey, pointer: `${loc.pointer}/${encodePointer(key)}` };
      const { node, loc: resolved } = await deref(raw, mediaLoc);
      if (node['itemSchema'] !== undefined) {
        unsupported(
          `Media type "${key}" uses "itemSchema" (streaming/sequential media types), which is not supported`,
          resolved,
        );
      }
      const schema: SchemaSource | undefined =
        node['schema'] === undefined
          ? undefined
          : {
              node: node['schema'],
              loc: { docKey: resolved.docKey, pointer: `${resolved.pointer}/schema` },
            };
      result.push({ key, schema, loc: resolved });
    }
    return result;
  }

  async function normalizeResponses(
    responses: unknown,
    loc: DocLocation,
  ): Promise<NormalizedResponses> {
    const exact = new Map<number, NormalizedResponse>();
    const ranges = new Map<number, NormalizedResponse>();
    let fallback: NormalizedResponse | undefined;
    const keys: string[] = [];
    if (responses === undefined) return { exact, ranges, default: undefined, keys };
    if (!isObj(responses))
      throw specInvalid(`"responses" must be an object at ${describe(loc)}.`, loc);
    for (const [key, raw] of Object.entries(responses)) {
      if (key.startsWith('x-')) continue;
      const responseLoc = { docKey: loc.docKey, pointer: `${loc.pointer}/${encodePointer(key)}` };
      const { node, loc: resolved } = await deref(raw, responseLoc);
      const response: NormalizedResponse = {
        key,
        headers: await normalizeHeaders(node['headers'], {
          docKey: resolved.docKey,
          pointer: `${resolved.pointer}/headers`,
        }),
        content: await normalizeContent(node['content'], {
          docKey: resolved.docKey,
          pointer: `${resolved.pointer}/content`,
        }),
        loc: resolved,
      };
      keys.push(key);
      const range = RANGE_STATUS.exec(key);
      if (key === 'default') fallback = response;
      else if (EXACT_STATUS.test(key)) exact.set(Number(key), response);
      else if (range) ranges.set(Number(range[1]), response);
      else throw specInvalid(`Invalid response key "${key}" at ${describe(loc)}.`, loc);
    }
    return { exact, ranges, default: fallback, keys };
  }

  const routing = options.routing;
  if (routing.basePath !== undefined && routing.serverIndex !== undefined) {
    throw new OpenApiConfigError(
      'Use either "routing.basePath" or "routing.serverIndex", not both.',
    );
  }
  let rootServers = root['servers'];
  if (routing.serverIndex !== undefined) {
    const list = Array.isArray(rootServers) ? (rootServers as unknown[]) : [];
    if (routing.serverIndex >= list.length) {
      throw new OpenApiConfigError(
        `"routing.serverIndex" is ${routing.serverIndex} but the document declares ${list.length} root server(s).`,
      );
    }
    rootServers = [list[routing.serverIndex]];
  }
  const prefixesFor = (servers: unknown, where: string): string[] =>
    routing.basePath === undefined
      ? serverPrefixes(servers, where, diagnostics)
      : [normalizePrefix(routing.basePath)];
  const rootPrefixes = prefixesFor(rootServers, '/servers');

  const operations: NormalizedOperation[] = [];
  const operationIds = new Map<string, string>();
  const paths = isObj(root['paths']) ? root['paths'] : {};

  for (const [template, rawItem] of Object.entries(paths)) {
    if (template.startsWith('x-')) continue;
    const itemLoc = { docKey: doc.rootKey, pointer: `/paths/${encodePointer(template)}` };
    const { node: item, loc: itemResolved } = await deref(rawItem, itemLoc);
    const itemServers = item['servers'];
    const itemPrefixes =
      itemServers === undefined || routing.basePath !== undefined
        ? rootPrefixes
        : prefixesFor(itemServers, `${itemResolved.pointer}/servers`);

    const methods: [string, unknown, string][] = FIXED_METHODS.filter(
      (m) => item[m] !== undefined,
    ).map((m) => [m.toUpperCase(), item[m], `${itemResolved.pointer}/${m}`]);
    const additional = item['additionalOperations'];
    if (isObj(additional)) {
      for (const [name, op] of Object.entries(additional)) {
        methods.push([
          name.toUpperCase(),
          op,
          `${itemResolved.pointer}/additionalOperations/${encodePointer(name)}`,
        ]);
      }
    }

    for (const [method, rawOperation, pointer] of methods) {
      const operationLoc = { docKey: itemResolved.docKey, pointer };
      if (!isObj(rawOperation))
        throw specInvalid(
          `Operation must be an object at ${describe(operationLoc)}.`,
          operationLoc,
        );
      const operationId =
        typeof rawOperation['operationId'] === 'string' ? rawOperation['operationId'] : undefined;
      if (operationId !== undefined) {
        const previous = operationIds.get(operationId);
        if (previous === undefined) operationIds.set(operationId, `${method} ${template}`);
        else {
          diagnostics.reportWarning(
            'spec.invalid',
            `operationId "${operationId}" is used by both ${previous} and ${method} ${template}; it must be unique.`,
            { operationId },
          );
        }
      }
      const prefixes =
        rawOperation['servers'] === undefined || routing.basePath !== undefined
          ? itemPrefixes
          : prefixesFor(rawOperation['servers'], `${pointer}/servers`);
      operations.push({
        method,
        path: template,
        operationId,
        prefixes,
        responses: await normalizeResponses(rawOperation['responses'], {
          docKey: operationLoc.docKey,
          pointer: `${pointer}/responses`,
        }),
        loc: operationLoc,
      });
    }
  }

  return { version: doc.version, operations };
}
