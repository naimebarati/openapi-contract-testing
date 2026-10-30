import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveOptions } from '../../src/contract/contract-options.js';
import type { OpenApiSpecError } from '../../src/index.js';
import { loadDocument } from '../../src/loader/load-document.js';
import { ReferenceResolver } from '../../src/loader/reference-resolver.js';

let tmp: string;
let root: string;
let outside: string;
let symlinksSupported = true;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'oct-security-'));
  root = path.join(tmp, 'root');
  outside = path.join(tmp, 'outside');
  await mkdir(path.join(root, 'sub'), { recursive: true });
  await mkdir(outside);
  await writeFile(
    path.join(root, 'openapi.yaml'),
    'openapi: 3.1.0\ninfo: {title: t, version: "1"}\npaths: {}\n',
  );
  await writeFile(path.join(root, 'sub', 'ok.yaml'), 'type: string\n');
  await writeFile(
    path.join(outside, 'secret.yaml'),
    'type: object\nproperties: {secret: {type: string}}\n',
  );
  try {
    await symlink(path.join(outside, 'secret.yaml'), path.join(root, 'link-to-file.yaml'));
    await symlink(outside, path.join(root, 'link-to-dir'));
  } catch {
    symlinksSupported = false;
  }
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function resolver(): Promise<{ r: ReferenceResolver; key: string }> {
  const key = path.join(root, 'openapi.yaml');
  const r = new ReferenceResolver(
    { rootDir: root, maxFiles: 10, maxBytesPerFile: 1024 * 1024 },
    { key, data: {}, dir: root },
  );
  await r.init();
  return { r, key };
}

async function failure(ref: string): Promise<OpenApiSpecError> {
  const { r, key } = await resolver();
  try {
    await r.resolve(key, ref);
  } catch (error) {
    return error as OpenApiSpecError;
  }
  throw new Error(`reference ${ref} was resolved but must be refused`);
}

describe('reference confinement', () => {
  it('allows files below the root, including subdirectories', async () => {
    const { r, key } = await resolver();
    expect(r.get(await r.resolve(key, './sub/ok.yaml'))).toEqual({ type: 'string' });
  });

  it.each([
    ['parent traversal', '../outside/secret.yaml'],
    ['deep traversal', './sub/../../outside/secret.yaml'],
    ['percent-encoded traversal', '%2e%2e/outside/secret.yaml'],
    ['encoded slash traversal', '..%2foutside%2fsecret.yaml'],
    ['absolute path', '/etc/passwd'],
  ])('refuses %s with reference.not_allowed', async (_name, ref) => {
    const error = await failure(ref);
    expect(error.issues[0]?.code).toBe('reference.not_allowed');
  });

  it('does not reveal whether a file outside the root exists', async () => {
    const existing = await failure('../outside/secret.yaml');
    const missing = await failure('../outside/does-not-exist.yaml');
    expect(existing.issues[0]?.code).toBe('reference.not_allowed');
    expect(missing.issues[0]?.code).toBe('reference.not_allowed');
  });

  it('refuses symlinks that point outside the root', async (ctx) => {
    if (!symlinksSupported) return ctx.skip();
    expect((await failure('./link-to-file.yaml')).issues[0]?.code).toBe('reference.not_allowed');
    expect((await failure('./link-to-dir/secret.yaml')).issues[0]?.code).toBe(
      'reference.not_allowed',
    );
  });

  it('refuses NUL bytes', async () => {
    expect((await failure('./sub/ok.yaml%00.png')).issues[0]?.code).toBe('reference.not_allowed');
  });

  it('refuses references from a document loaded through source when rootDir is narrower', async () => {
    const key = path.join(root, 'sub', 'ok.yaml');
    const r = new ReferenceResolver(
      { rootDir: path.join(root, 'sub'), maxFiles: 5, maxBytesPerFile: 1024 },
      { key, data: {}, dir: path.join(root, 'sub') },
    );
    await r.init();
    await expect(r.resolve(key, '../openapi.yaml')).rejects.toMatchObject({
      issues: [{ code: 'reference.not_allowed' }],
    });
  });
});

describe('URL references are never fetched', () => {
  it.each([
    'http://127.0.0.1/secret.yaml',
    'https://169.254.169.254/latest/meta-data/',
    'file:///etc/passwd',
    'ftp://example.com/a.yaml',
    'data:text/plain;base64,AAAA',
    '//example.com/a.yaml#/x',
  ])('%s', async (ref) => {
    const error = await failure(ref);
    expect(['reference.not_allowed', 'reference.not_found']).toContain(error.issues[0]?.code);
  });

  it('uses reference.not_allowed with a clear message for schemes, and redacts credentials', async () => {
    const error = await failure('https://user:hunter2@example.com/spec.yaml?token=abc123#/x');
    expect(error.issues[0]?.code).toBe('reference.not_allowed');
    expect(error.message).toContain('"https:" scheme');
    expect(error.message).not.toContain('hunter2');
    expect(error.message).not.toContain('abc123');
  });

  it('treats Windows drive letters as paths, not URL schemes', async () => {
    const error = await failure('C:\\Windows\\win.ini');
    expect(error.message).not.toContain('scheme');
  });
});

describe('document-level limits', () => {
  it('limits the entry file size', async () => {
    await expect(
      loadDocument(
        resolveOptions({ source: path.join(root, 'openapi.yaml'), refs: { maxBytesPerFile: 5 } }),
      ),
    ).rejects.toThrow(/byte limit/);
  });

  it('refuses external references from in-memory documents without baseDir', async () => {
    const doc = await loadDocument(
      resolveOptions({
        document: { openapi: '3.1.0', info: { title: 't', version: '1' }, paths: {} },
      }),
    );
    await expect(doc.resolver.resolve(doc.rootKey, './sub/ok.yaml')).rejects.toMatchObject({
      issues: [{ code: 'reference.not_allowed' }],
    });
  });

  it('allows external references from in-memory documents when baseDir is set', async () => {
    const doc = await loadDocument(
      resolveOptions({
        document: { openapi: '3.1.0', info: { title: 't', version: '1' }, paths: {} },
        baseDir: root,
      }),
    );
    const location = await doc.resolver.resolve(doc.rootKey, './sub/ok.yaml');
    expect(doc.resolver.get(location)).toEqual({ type: 'string' });
  });
});
