import type { ResolvedOptions } from '../contract/contract-options.js';
import { OpenApiSpecError } from '../diagnostics/errors.js';
import { createIssue } from '../diagnostics/issue-factory.js';
import type { LoadedDocument } from '../loader/load-document.js';
import type { DocLocation } from '../loader/reference-resolver.js';
import type { NormalizedDocument, NormalizedResponse, SchemaSource } from '../normalize/model.js';
import { parseMediaType } from '../utils/media-type.js';
import type { ParsedMediaType } from '../utils/media-type.js';
import { SchemaCompiler } from './schema-compiler.js';
import type { SchemaHandle } from './schema-compiler.js';
import { valueSpecFor } from './scalar-values.js';
import type { ValueSpec } from './scalar-values.js';

export interface CompiledHeader {
  /** Name as written in the contract. */
  name: string;
  required: boolean;
  spec: ValueSpec;
  handle: SchemaHandle | undefined;
}

export interface CompiledMediaType {
  key: string;
  range: ParsedMediaType;
  handle: SchemaHandle | undefined;
  /** How a `text/*` body is converted before it is validated. */
  textSpec: ValueSpec;
}

export interface CompiledResponse {
  key: string;
  headers: readonly CompiledHeader[];
  mediaTypes: readonly CompiledMediaType[];
  /** The contract declares `content` for this response, so a body is expected. */
  contentDefined: boolean;
}

export interface CompiledContract {
  readonly compiler: SchemaCompiler;
  responseOf(response: NormalizedResponse): CompiledResponse;
}

/** Compiles every schema used by response headers and bodies, once, at load time. */
export async function compileContract(
  doc: LoadedDocument,
  model: NormalizedDocument,
  options: ResolvedOptions,
): Promise<CompiledContract> {
  const compiler = new SchemaCompiler(
    doc.version,
    doc.resolver,
    doc.rootKey,
    doc.diagnostics,
    options.validation,
  );
  const compiled = new Map<NormalizedResponse, CompiledResponse>();

  const specFor = async (source: SchemaSource): Promise<ValueSpec> => {
    const peeked = await compiler.peek(source);
    const node = peeked.node;
    let items: unknown;
    if (typeof node === 'object' && node !== null && 'items' in node) {
      const itemLoc: DocLocation = {
        docKey: peeked.loc.docKey,
        pointer: `${peeked.loc.pointer}/items`,
      };
      items = (await compiler.peek({ node: node.items, loc: itemLoc })).node;
    }
    return valueSpecFor(node, () => items);
  };

  for (const operation of model.operations) {
    const { exact, ranges, default: fallback } = operation.responses;
    for (const response of [
      ...exact.values(),
      ...ranges.values(),
      ...(fallback ? [fallback] : []),
    ]) {
      if (compiled.has(response)) continue;

      const headers: CompiledHeader[] = [];
      for (const header of response.headers) {
        let spec: ValueSpec = { kind: 'any' };
        let handle: SchemaHandle | undefined;
        if (header.schema) {
          handle = await compiler.add(header.schema);
          spec = await specFor(header.schema);
          if (spec.kind === 'unsupported') {
            doc.diagnostics.reportUnsupported(
              `Header "${header.name}" can only be checked for presence: ${spec.reason} (${doc.resolver.label(header.loc.docKey)}#${header.loc.pointer})`,
              { schemaPath: header.loc.pointer },
            );
          }
        }
        headers.push({ name: header.name, required: header.required, spec, handle });
      }

      const mediaTypes: CompiledMediaType[] = [];
      for (const media of response.content) {
        const range = parseMediaType(media.key);
        if (!range) {
          const message = `Invalid media type "${media.key}" at ${doc.resolver.label(media.loc.docKey)}#${media.loc.pointer}.`;
          throw new OpenApiSpecError(message, [
            createIssue('spec.invalid', message, { schemaPath: media.loc.pointer }),
          ]);
        }
        const handle = media.schema ? await compiler.add(media.schema) : undefined;
        const textSpec: ValueSpec = media.schema ? await specFor(media.schema) : { kind: 'any' };
        mediaTypes.push({ key: media.key, range, handle, textSpec });
      }

      compiled.set(response, {
        key: response.key,
        headers,
        mediaTypes,
        contentDefined: response.content.length > 0,
      });
    }
  }

  compiler.build();
  return {
    compiler,
    responseOf(response) {
      const found = compiled.get(response);
      if (!found) throw new Error('Response was not compiled');
      return found;
    },
  };
}
