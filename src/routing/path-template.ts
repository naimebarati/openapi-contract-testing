import { OpenApiSpecError } from '../diagnostics/errors.js';
import { createIssue } from '../diagnostics/issue-factory.js';

/** 2 = fully static, 1 = literal text mixed with parameters (`{name}.{ext}`), 0 = a lone `{param}`. */
export type SegmentRank = 0 | 1 | 2;

export interface TemplateSegment {
  rank: SegmentRank;
  /** Decoded literal of a static segment. */
  literal: string;
  /** Matches a decoded request segment for rank 0 and 1. */
  pattern: RegExp | undefined;
  /** Canonical form with parameter names removed, used for collision detection. */
  canonical: string;
}

export interface ParsedTemplate {
  segments: TemplateSegment[];
  canonical: string;
  staticCount: number;
}

const PARAM = /\{([^{}/]*)\}/g;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Splits an absolute path into raw segments. The root path has no segments. */
export function splitPath(path: string): string[] {
  return path === '/' ? [] : path.slice(1).split('/');
}

export function parsePathTemplate(template: string): ParsedTemplate {
  if (!template.startsWith('/')) {
    throw invalid(`Path "${template}" must start with "/".`, template);
  }
  const names = new Set<string>();
  const segments = splitPath(template).map((raw): TemplateSegment => {
    const params = [...raw.matchAll(PARAM)];
    const stripped = raw.replace(PARAM, '');
    if (stripped.includes('{') || stripped.includes('}')) {
      throw invalid(`Path "${template}" has unbalanced braces.`, template);
    }
    for (const match of params) {
      const name = match[1] ?? '';
      if (name === '') throw invalid(`Path "${template}" has an empty parameter name.`, template);
      if (names.has(name))
        throw invalid(`Path "${template}" uses parameter "{${name}}" more than once.`, template);
      names.add(name);
    }
    if (params.length === 0) {
      const literal = safeDecode(raw);
      return { rank: 2, literal, pattern: undefined, canonical: `s:${literal}` };
    }
    if (params.length === 1 && raw === params[0]?.[0]) {
      return { rank: 0, literal: '', pattern: /^[\s\S]+$/, canonical: 'p:{}' };
    }
    const source = raw
      .split(PARAM)
      // split() with a capture group alternates literal, name, literal, name, ...
      .map((part, index) => (index % 2 === 1 ? '([\\s\\S]+?)' : escapeRegExp(safeDecode(part))))
      .join('');
    return {
      rank: 1,
      literal: '',
      pattern: new RegExp(`^${source}$`),
      canonical: `m:${raw.replace(PARAM, '{}')}`,
    };
  });
  return {
    segments,
    canonical: segments.map((s) => s.canonical).join('/'),
    staticCount: segments.filter((s) => s.rank === 2).length,
  };
}

export function segmentMatches(segment: TemplateSegment, value: string): boolean {
  return segment.rank === 2 ? segment.literal === value : (segment.pattern?.test(value) ?? false);
}

function invalid(message: string, template: string): OpenApiSpecError {
  return new OpenApiSpecError(message, [
    createIssue('spec.invalid', message, { pathTemplate: template }),
  ]);
}
