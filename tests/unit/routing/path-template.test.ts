import { describe, expect, it } from 'vitest';
import { OpenApiSpecError } from '../../../src/index.js';
import {
  parsePathTemplate,
  segmentMatches,
  splitPath,
} from '../../../src/routing/path-template.js';

describe('parsePathTemplate', () => {
  it('ranks segments and counts static ones', () => {
    const t = parsePathTemplate('/users/{id}/files/{name}.{ext}');
    expect(t.segments.map((s) => s.rank)).toEqual([2, 0, 2, 1]);
    expect(t.staticCount).toBe(2);
  });

  it('gives templates that differ only in parameter names the same canonical form', () => {
    expect(parsePathTemplate('/users/{id}').canonical).toBe(
      parsePathTemplate('/users/{name}').canonical,
    );
    expect(parsePathTemplate('/users/{id}').canonical).not.toBe(
      parsePathTemplate('/users/me').canonical,
    );
  });

  it('matches mixed segments', () => {
    const mixed = parsePathTemplate('/files/{name}.{ext}').segments[1]!;
    expect(segmentMatches(mixed, 'report.pdf')).toBe(true);
    expect(segmentMatches(mixed, 'a.b.c')).toBe(true);
    expect(segmentMatches(mixed, 'noext')).toBe(false);
    expect(segmentMatches(mixed, '.pdf')).toBe(false);
  });

  it('never treats literal text as a regular expression', () => {
    const lit = parsePathTemplate('/v1.0/(a+)').segments;
    expect(segmentMatches(lit[0]!, 'v1.0')).toBe(true);
    expect(segmentMatches(lit[0]!, 'v1x0')).toBe(false);
    expect(segmentMatches(lit[1]!, '(a+)')).toBe(true);
    expect(segmentMatches(lit[1]!, 'aaa')).toBe(false);
  });

  it('decodes literal segments', () => {
    expect(parsePathTemplate('/a%20b').segments[0]!.literal).toBe('a b');
  });

  it.each(['users', '/users/{', '/users/{}', '/users/{id}/{id}', '/users/}{'])(
    'rejects %s',
    (template) => {
      expect(() => parsePathTemplate(template)).toThrow(OpenApiSpecError);
    },
  );

  it('splits paths', () => {
    expect(splitPath('/')).toEqual([]);
    expect(splitPath('/a/b/')).toEqual(['a', 'b', '']);
  });
});
