import { describe, expect, it } from 'vitest';
import { OpenApiSpecError } from '../../../src/index.js';
import { detectFormat, parseDocumentText } from '../../../src/loader/yaml-json-parser.js';

describe('parseDocumentText', () => {
  it('parses YAML and JSON', () => {
    expect(parseDocumentText('a: 1\nb: [x, y]', 'yaml', 't')).toEqual({ a: 1, b: ['x', 'y'] });
    expect(parseDocumentText('{"a":1}', 'json', 't')).toEqual({ a: 1 });
  });

  it('reports YAML syntax errors with a position', () => {
    try {
      parseDocumentText('a:\n  b: 1\n c: 2\n', 'yaml', 'spec.yaml');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(OpenApiSpecError);
      const issue = (error as OpenApiSpecError).issues[0];
      expect(issue?.code).toBe('spec.invalid');
      expect(issue?.sourceLocation?.line).toBe(3);
      expect((error as Error).message).toMatch(/at line 3, column 1: /);
      expect((error as Error).message).not.toMatch(/line 3.*line 3/);
      expect((error as Error).message).toContain('spec.yaml');
    }
  });

  it('reports duplicate YAML keys', () => {
    expect(() => parseDocumentText('a: 1\na: 2\n', 'yaml', 't')).toThrow(OpenApiSpecError);
  });

  it('reports invalid JSON', () => {
    expect(() => parseDocumentText('{"a":', 'json', 't')).toThrow(/invalid JSON/);
  });

  it('refuses alias expansion bombs without crashing', () => {
    let yaml = 'a0: &a0 [x, x, x, x, x, x, x, x, x, x]\n';
    for (let i = 1; i < 12; i++) {
      yaml += `a${i}: &a${i} [${Array<string>(10)
        .fill(`*a${i - 1}`)
        .join(', ')}]\n`;
    }
    expect(() => parseDocumentText(yaml, 'yaml', 'bomb.yaml')).toThrow(OpenApiSpecError);
  });

  it('keeps __proto__ keys inert', () => {
    const fromYaml = parseDocumentText('__proto__: {polluted: true}', 'yaml', 't') as Record<
      string,
      unknown
    >;
    const fromJson = parseDocumentText('{"__proto__":{"polluted":true}}', 'json', 't') as Record<
      string,
      unknown
    >;
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.getPrototypeOf(fromYaml)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(fromJson)).toBe(Object.prototype);
  });
});

describe('detectFormat', () => {
  it('uses the extension, then sniffs the content', () => {
    expect(detectFormat('a.json', '')).toBe('json');
    expect(detectFormat('a.yml', '{')).toBe('yaml');
    expect(detectFormat('a.txt', '  {"a":1}')).toBe('json');
    expect(detectFormat('a.txt', 'a: 1')).toBe('yaml');
  });
});
