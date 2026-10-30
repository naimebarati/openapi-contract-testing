import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { OpenApiSpecError } from '../diagnostics/errors.js';
import { createIssue } from '../diagnostics/issue-factory.js';
import { deepFreeze } from '../utils/deep-freeze.js';
import { detectFormat, parseDocumentText } from './yaml-json-parser.js';

/** A position inside one of the loaded documents. `docKey` identifies the document. */
export interface DocLocation {
  docKey: string;
  /** JSON Pointer without the leading `#` (empty string = whole document). */
  pointer: string;
}

export interface ResolverLimits {
  /** Files outside this directory are never read. `undefined` = file references are refused. */
  rootDir: string | undefined;
  maxFiles: number;
  maxBytesPerFile: number;
}

export interface RootDocument {
  key: string;
  data: unknown;
  /** Directory against which relative references of this document are resolved. */
  dir: string | undefined;
}

interface LoadedDoc {
  data: unknown;
  dir: string | undefined;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_DRIVE = /^[a-z]:[\\/]/i;
const ARRAY_INDEX = /^(?:0|[1-9]\d*)$/;

/**
 * Resolves `$ref` strings to locations inside loaded documents.
 *
 * Security properties (see ADR-0002): only local files below `rootDir` can be read, checked on the
 * `realpath` of both so `..` and symlinks cannot escape; URL schemes are always refused; the number
 * and size of files is bounded. Failures are `reference.not_allowed` / `reference.not_found`.
 */
export class ReferenceResolver {
  private readonly docs = new Map<string, LoadedDoc>();
  private realRoot: string | undefined;

  constructor(
    private readonly limits: ResolverLimits,
    root: RootDocument,
  ) {
    this.docs.set(root.key, { data: root.data, dir: root.dir });
  }

  get fileCount(): number {
    return this.docs.size;
  }

  /** Resolves `ref` relative to the document `fromKey`, loading the target file when necessary. */
  async resolve(fromKey: string, ref: string): Promise<DocLocation> {
    const hash = ref.indexOf('#');
    const uriPart = hash === -1 ? ref : ref.slice(0, hash);
    const fragment = hash === -1 ? '' : ref.slice(hash + 1);

    let docKey = fromKey;
    if (uriPart !== '') {
      if (SCHEME.test(uriPart) && !WINDOWS_DRIVE.test(uriPart)) {
        const scheme = uriPart.slice(0, uriPart.indexOf(':'));
        throw notAllowed(
          `Reference "${redactUrl(ref)}" uses the "${scheme}:" scheme. Only local file references inside the root directory are supported; remote references are not implemented.`,
        );
      }
      docKey = await this.loadFile(fromKey, uriPart, ref);
    }

    if (fragment !== '' && !fragment.startsWith('/')) {
      throw new OpenApiSpecError(
        `Unsupported reference "${ref}": anchor fragments are not supported.`,
        [
          createIssue(
            'spec.unsupported_feature',
            `Reference "${ref}" uses an anchor fragment, which is not supported.`,
          ),
        ],
      );
    }
    let pointer = '';
    if (fragment !== '') {
      try {
        pointer = decodeURIComponent(fragment);
      } catch {
        throw notFound(`Reference "${ref}" contains an invalid percent-encoding.`);
      }
    }
    return { docKey, pointer };
  }

  /** Returns the value at `location`. Throws `reference.not_found` if it does not exist. */
  get(location: DocLocation): unknown {
    const doc = this.docs.get(location.docKey);
    if (!doc) throw notFound(`Document "${this.label(location.docKey)}" is not loaded.`);
    if (location.pointer === '') return doc.data;
    let current: unknown = doc.data;
    for (const raw of location.pointer.slice(1).split('/')) {
      const part = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      if (Array.isArray(current)) {
        if (!ARRAY_INDEX.test(part) || Number(part) >= current.length) {
          throw this.missing(location);
        }
        current = current[Number(part)];
      } else if (typeof current === 'object' && current !== null && Object.hasOwn(current, part)) {
        current = (current as Record<string, unknown>)[part];
      } else {
        throw this.missing(location);
      }
    }
    return current;
  }

  /** Human-readable name of a document for messages: relative to the root directory, never absolute. */
  label(docKey: string): string {
    if (!path.isAbsolute(docKey)) return docKey;
    const root = this.limits.rootDir;
    return root === undefined
      ? path.basename(docKey)
      : path.relative(root, docKey) || path.basename(docKey);
  }

  private missing(location: DocLocation): OpenApiSpecError {
    return notFound(
      `Reference target "${this.label(location.docKey)}#${location.pointer}" does not exist.`,
    );
  }

  private async loadFile(fromKey: string, uriPart: string, ref: string): Promise<string> {
    const rootDir = this.limits.rootDir;
    const from = this.docs.get(fromKey);
    const baseDir = from?.dir ?? rootDir;
    if (rootDir === undefined || baseDir === undefined) {
      throw notAllowed(
        `Reference "${ref}" points to a file, but no root directory is configured. Pass "source", or set "baseDir" / "refs.rootDir" to allow file references.`,
      );
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(uriPart);
    } catch {
      throw notFound(`Reference "${ref}" contains an invalid percent-encoding.`);
    }
    if (decoded.includes('\0')) throw notAllowed(`Reference "${ref}" contains a NUL character.`);

    const target = path.resolve(baseDir, decoded);
    let real: string;
    try {
      real = await realpath(target);
    } catch {
      // A missing file below the root is "not found"; confinement is re-checked lexically first so a
      // missing file outside the root does not reveal whether it exists.
      this.assertInside(path.resolve(target), ref, false);
      throw notFound(`Referenced file "${this.label(target)}" was not found (reference "${ref}").`);
    }
    this.assertInside(real, ref, true);

    if (this.docs.has(real)) return real;
    if (this.docs.size >= this.limits.maxFiles) {
      throw notAllowed(`Too many referenced files (limit ${this.limits.maxFiles}).`);
    }
    const text = await this.readBounded(real, ref);
    const data = deepFreeze(parseDocumentText(text, detectFormat(real, text), this.label(real)));
    this.docs.set(real, { data, dir: path.dirname(real) });
    return real;
  }

  private assertInside(candidate: string, ref: string, isReal: boolean): void {
    const root = this.realRoot ?? this.limits.rootDir;
    if (root === undefined) throw notAllowed(`Reference "${ref}" is not allowed.`);
    const base = isReal ? root : (this.limits.rootDir ?? root);
    const relative = path.relative(base, candidate);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw notAllowed(
        `Reference "${ref}" resolves outside the allowed root directory and was not read.`,
      );
    }
  }

  /** Must be called once before resolving file references: canonicalizes the root directory. */
  async init(): Promise<void> {
    if (this.limits.rootDir !== undefined) {
      try {
        this.realRoot = await realpath(this.limits.rootDir);
      } catch {
        throw notFound(`Root directory "${this.limits.rootDir}" does not exist.`);
      }
    }
  }

  private async readBounded(file: string, ref: string): Promise<string> {
    const max = this.limits.maxBytesPerFile;
    const handle = await open(file, 'r');
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) throw notAllowed(`Reference "${ref}" does not point to a regular file.`);
      if (stats.size > max) {
        throw notAllowed(`Referenced file "${this.label(file)}" exceeds the ${max} byte limit.`);
      }
      const buffer = Buffer.alloc(max + 1);
      let total = 0;
      for (;;) {
        const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
        if (bytesRead === 0) break;
        total += bytesRead;
        if (total > max) {
          throw notAllowed(`Referenced file "${this.label(file)}" exceeds the ${max} byte limit.`);
        }
      }
      return buffer.subarray(0, total).toString('utf8');
    } finally {
      await handle.close();
    }
  }
}

/** Strips credentials and query values from URL-like references before they reach a message. */
function redactUrl(ref: string): string {
  try {
    const url = new URL(ref);
    url.username = '';
    url.password = '';
    url.search = '';
    return url.toString();
  } catch {
    return ref.replace(/\/\/[^/@]*@/, '//');
  }
}

function notAllowed(message: string): OpenApiSpecError {
  return new OpenApiSpecError(message, [createIssue('reference.not_allowed', message)]);
}

function notFound(message: string): OpenApiSpecError {
  return new OpenApiSpecError(message, [createIssue('reference.not_found', message)]);
}
