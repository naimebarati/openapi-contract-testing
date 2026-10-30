import { describe, expect, it } from 'vitest';
import { extractRequestPath } from '../../../src/utils/url.js';

const path = (url: string | URL, base?: string) => {
  const r = extractRequestPath(url, base);
  return r.ok ? r.path : `ERR:${r.reason}`;
};

describe('extractRequestPath', () => {
  it('uses the pathname of absolute URLs and ignores host, query and fragment', () => {
    expect(path('http://localhost:3000/api/v1/users/1?token=secret#frag')).toBe('/api/v1/users/1');
    expect(path('https://example.org/a')).toBe('/a');
    expect(path(new URL('http://x/y/z?q=1'))).toBe('/y/z');
  });

  it('accepts paths without needing a real origin', () => {
    expect(path('/users/1?x=1#y')).toBe('/users/1');
    expect(path('/')).toBe('/');
  });

  it('keeps percent-encoding so %2F is not turned into a separator', () => {
    expect(path('/files/a%2Fb')).toBe('/files/a%2Fb');
  });

  it('normalizes dot segments like a real server stack', () => {
    expect(path('/a/b/../c')).toBe('/a/c');
  });

  it('joins the path of baseUrl for relative request URLs only', () => {
    expect(path('/users/1', 'http://localhost:3000/api/v1')).toBe('/api/v1/users/1');
    expect(path('/users/1', 'http://localhost:3000/api/v1/')).toBe('/api/v1/users/1');
    expect(path('http://other/users/1', 'http://localhost:3000/api/v1')).toBe('/users/1');
  });

  it('rejects ambiguous or unsupported inputs instead of guessing', () => {
    expect(path('users/1')).toMatch(/^ERR:/);
    expect(path('//evil.example/users')).toMatch(/^ERR:/);
    expect(path('ftp://host/a')).toMatch(/unsupported URL scheme/);
    expect(path('http://')).toMatch(/^ERR:/);
    expect(path('')).toMatch(/^ERR:/);
  });
});
