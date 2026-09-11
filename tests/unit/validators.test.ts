import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  validateAdminLevel,
  validateDataRelease,
  validateDateParams,
  validateModelRelease,
  validateRequestedProperties,
  validateRequiredQueryParams,
} from '../../src/utils/validators.ts';
import fixtureConfig from '../fixtures/fixture-config.json' with { type: 'json' };

vi.mock('../../src/utils/endpoints.ts', () => ({
  endpointConfigs: {
    '/test': {
      requiredParams: ['gene', 'mutation', 'properties'],
    },
  },
}));

const mockReqRes = (query: Record<string, string | undefined>, path = '/test') => {
  const response = {
    status: vi.fn(),
    send: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return {
    req: { path, query } as unknown as Request,
    res: response as unknown as Response,
  };
};

describe('validateRequiredQueryParams', () => {
  it('reports every missing parameter', () => {
    const { req, res } = mockReqRes({ gene: 'crt', mutation: '', properties: undefined });

    expect(
      validateRequiredQueryParams(req, res)
    ).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      error: 'Missing required query parameters: mutation, properties',
    });
  });

  it('accepts a request containing every required parameter', () => {
    const { req, res, } = mockReqRes({
      gene: 'crt',
      mutation: '76K',
      properties: 'gene',
    });

    expect(
      validateRequiredQueryParams(req, res)
    ).toBe(true);
    expect(res.send).not.toHaveBeenCalled();
  });
});

describe('validateRequestedProperties', () => {
  const dbTypes = { admin1: 'VARCHAR', median: 'DOUBLE' };

  it('requires at least one property', () => {
    const { res } = mockReqRes({});

    expect(
      validateRequestedProperties([], ['admin1', 'median'], dbTypes, res)
    ).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a property outside the endpoint allow-list', () => {
    const { res, } = mockReqRes({});

    expect(
      validateRequestedProperties(['admin1', 'median'], ['median'], dbTypes, res)
    ).toBe(false);
    expect(res.send).toHaveBeenCalledWith({ error: 'Invalid property requested: admin1' });
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects an allowed property absent from the parquet file', () => {
    const { res, } = mockReqRes({});

    expect(
      validateRequestedProperties(['median'], ['median'], {}, res)
    ).toBe(false);
    expect(res.send).toHaveBeenCalledWith({ error: 'Invalid property requested: median' });
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns true if the requested property list is valid', () => {
    const { res } = mockReqRes({});

    expect(
      validateRequestedProperties(['admin1', 'median'], ['admin1', 'median'], dbTypes, res)
    ).toBe(true);
  });
});

describe('release validators', () => {
  it('accepts a known model release', () => {
    const { res } = mockReqRes({});
    expect(validateModelRelease(fixtureConfig.modelRelease, res)).toBe(true);
  });

  it('rejects an unknown model release', () => {
    const { res } = mockReqRes({ model_release: '../private' });

    expect(validateModelRelease("../private", res)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('accepts a known data release', () => {
    const { req, res } = mockReqRes({ data_release: fixtureConfig.dataRelease });
    expect(validateDataRelease(req, res)).toBe(true);
  });

  it('rejects an unknown data release', () => {
    const { req, res } = mockReqRes({ data_release: '../private' });

    expect(validateDataRelease(req, res)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('validateDateParams', () => {
  it.each(['date', 'date_from', 'date_to'])('rejects an invalid %s format', (parameter) => {
    const { req, res } = mockReqRes({ [parameter]: '01-05-2024' });

    expect(validateDateParams(req, res, "YYYY-MM-DD")).toBe(false);
    expect(res.send).toHaveBeenCalledWith({
      error: `Invalid date for parameter '${parameter}'. Expected YYYY-MM-DD.`,
    });
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it.each(['date', 'date_from', 'date_to'])('rejects an invalid date for %s', (parameter) => {
    const { req, res } = mockReqRes({ [parameter]: '2026-99-99' });

    expect(validateDateParams(req, res, "YYYY-MM-DD")).toBe(false);
    expect(res.send).toHaveBeenCalledWith({
      error: `Invalid date for parameter '${parameter}'. Expected YYYY-MM-DD.`,
    });
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it.each(['date_from', 'date_to'])('requires %s with the other date range parameter', (parameter) => {
    const { req, res } = mockReqRes({ [parameter]: '2024-01-01' });

    expect(validateDateParams(req, res, "YYYY-MM-DD")).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects when date_from is later than date_to', () => {
    const { req, res } = mockReqRes({
      date_from: '2025-01-01',
      date_to: '2024-01-01',
    });

    expect(validateDateParams(req, res, "YYYY-MM-DD")).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('accepts a valid date range', () => {
    const { req, res } = mockReqRes({
      date_from: '2024-01-01',
      date_to: '2025-01-01',
    });
    expect(validateDateParams(req, res, "YYYY-MM-DD")).toBe(true);
  });
});

describe('validateDateParams for prevalences', () => {
  it.each([
    { date: '2024-05' },
    { date_from: '2024-05', date_to: '2025-05' },
  ])('accepts valid month parameters: %o', (query) => {
    const { req, res } = mockReqRes(query);
    expect(validateDateParams(req, res, "YYYY-MM")).toBe(true);
  });

  it.each(['2024-05-01', '2024-13'])('rejects an invalid month value: %s', (date) => {
    const { req, res } = mockReqRes({ date });

    expect(validateDateParams(req, res, "YYYY-MM")).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      error: "Invalid date for parameter 'date'. Expected YYYY-MM.",
    });
  });
});

describe('validateAdminLevel', () => {
  it('requires admin_level to be present', () => {
    const { req, res } = mockReqRes({});

    expect(validateAdminLevel(req, res)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('requires admin_level to be non-empty', () => {
    const { req, res } = mockReqRes({ admin_level: '' });

    expect(validateAdminLevel(req, res)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects an unsupported admin level', () => {
    const { req, res } = mockReqRes({ admin_level: '3' });

    expect(validateAdminLevel(req, res)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a containing region more granular than the results', () => {
    const { req, res } = mockReqRes({
      admin_level: '1',
      admin2: 'MLI.1.1_1',
    });

    expect(validateAdminLevel(req, res)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('accepts a valid level and containing region', () => {
    const { req, res } = mockReqRes({ admin_level: '2', admin1: 'MLI.1_1' });
    expect(validateAdminLevel(req, res)).toBe(true);
  });
});
