import { describe, expect, it } from 'vitest';
import { extractJson, tryExtractJson } from '../src/llm-json';

describe('extractJson', () => {
  it('parses clean JSON', () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it('parses JSON array', () => {
    expect(extractJson('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('extracts from markdown fence', () => {
    const response = 'Here is the result:\n```json\n{"a": 1}\n```\n';
    expect(extractJson(response)).toEqual({ a: 1 });
  });

  it('extracts from fence without json tag', () => {
    const response = 'Result:\n```\n{"a": 1}\n```';
    expect(extractJson(response)).toEqual({ a: 1 });
  });

  it('extracts outermost JSON object from prose', () => {
    const response = 'The answer is {"a": 1} and that is it.';
    expect(extractJson(response)).toEqual({ a: 1 });
  });

  it('extracts outermost JSON array from prose', () => {
    const response = 'Results: [1, 2, 3]. Done.';
    expect(extractJson(response)).toEqual([1, 2, 3]);
  });

  it('handles whitespace around JSON', () => {
    expect(extractJson('  {"a": 1}  ')).toEqual({ a: 1 });
  });

  it('throws for non-JSON text', () => {
    expect(() => extractJson('no json here')).toThrow('parseable JSON');
  });

  it('throws for empty string', () => {
    expect(() => extractJson('')).toThrow('parseable JSON');
  });
});

describe('tryExtractJson', () => {
  it('returns parsed value on success', () => {
    expect(tryExtractJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it('returns undefined on failure', () => {
    expect(tryExtractJson('not json')).toBeUndefined();
  });
});
