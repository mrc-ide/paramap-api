import type { Query } from 'express-serve-static-core';
import { describe, expect, it, vi } from 'vitest';
import { getQueryParamArr, getQueryParamStr } from '../../src/utils/query.ts';

describe('getQueryParamStr', () => {
  it('returns a single string parameter', () => {
    expect(getQueryParamStr({ gene: 'crt' }, 'gene')).toBe('crt');
  });

  it('returns undefined when the parameter is absent', () => {
    expect(getQueryParamStr({}, 'gene')).toBeUndefined();
  });

  it.each([
    ['a comma-separated value', { gene: 'crt,mdr1' }],
    ['repeated values', { gene: ['crt', 'mdr1'] }],
    ['an object value', { gene: { nested: 'crt' } }],
  ] satisfies [string, Query][])('rejects %s', (_description, query) => {
    expect(() => getQueryParamStr(query, 'gene')).toThrow("Query parameter \"gene\" must be a single string");
  });
});

describe('getQueryParamArr', () => {
  it('splits a comma-separated string into an array', () => {
    expect(getQueryParamArr({ properties: 'admin1,median' }, 'properties'))
      .toEqual(['admin1', 'median']);
  });

  it('returns a single string value as a one-item array', () => {
    expect(getQueryParamArr({ properties: 'admin1' }, 'properties'))
      .toEqual(['admin1']);
  });

  it('accepts repeated string values', () => {
    expect(getQueryParamArr({ properties: ['admin1', 'median'] }, 'properties'))
      .toEqual(['admin1', 'median']);
  });

  it.each([
    ['a missing value', {}],
    ['an object value', { properties: { nested: 'admin1' } }],
    ['an array containing an object', { properties: ['admin1', { nested: 'median' }] }],
  ] satisfies [string, Query][])('rejects %s', (_description, query) => {
    expect(() => getQueryParamArr(query, 'properties')).toThrow("Query parameter \"properties\" must be an array of string");
  });
});
