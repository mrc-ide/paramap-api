import type { Response } from 'express';
import type { Query } from 'express-serve-static-core';
import { describe, expect, it, vi } from 'vitest';
import { getQueryParamArr, getQueryParamStr } from '../../src/utils/query.ts';

const mockResponse = () => {
  const response = {
    status: vi.fn(),
    send: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response as unknown as Response;
};

describe('getQueryParamStr', () => {
  it('returns a single string parameter', () => {
    const response = mockResponse();

    expect(getQueryParamStr(response, { gene: 'crt' }, 'gene')).toBe('crt');
    expect(response.status).not.toHaveBeenCalled();
  });

  it('returns undefined when the parameter is absent', () => {
    const response = mockResponse();

    expect(getQueryParamStr(response, {}, 'gene')).toBeUndefined();
    expect(response.status).not.toHaveBeenCalled();
  });

  it.each([
    ['a comma-separated value', { gene: 'crt,mdr1' }],
    ['repeated values', { gene: ['crt', 'mdr1'] }],
    ['an object value', { gene: { nested: 'crt' } }],
  ] satisfies [string, Query][])('rejects %s', (_description, query) => {
    const response = mockResponse();

    expect(getQueryParamStr(response, query, 'gene')).toBeUndefined();
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.send).toHaveBeenCalledWith({
      error: 'Query parameter "gene" must be a single string',
    });
  });
});

describe('getQueryParamArr', () => {
  it('splits a comma-separated string into an array', () => {
    const response = mockResponse();

    expect(getQueryParamArr(response, { properties: 'admin1,median' }, 'properties'))
      .toEqual(['admin1', 'median']);
    expect(response.status).not.toHaveBeenCalled();
  });

  it('returns a single string value as a one-item array', () => {
    const response = mockResponse();

    expect(getQueryParamArr(response, { properties: 'admin1' }, 'properties'))
      .toEqual(['admin1']);
  });

  it('accepts repeated string values', () => {
    const response = mockResponse();

    expect(getQueryParamArr(response, { properties: ['admin1', 'median'] }, 'properties'))
      .toEqual(['admin1', 'median']);
    expect(response.status).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing value', {}],
    ['an object value', { properties: { nested: 'admin1' } }],
    ['an array containing an object', { properties: ['admin1', { nested: 'median' }] }],
  ] satisfies [string, Query][])('rejects %s', (_description, query) => {
    const response = mockResponse();

    expect(getQueryParamArr(response, query, 'properties')).toBeUndefined();
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.send).toHaveBeenCalledWith({
      error: 'Query parameter "properties" must be an array',
    });
  });
});
