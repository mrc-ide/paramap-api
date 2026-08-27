import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  validateAdmin0,
  validateAdminLevel,
  validateDataRelease,
  validateDateIsFirstOfMonth,
  validateDateParams,
  validateModelRelease,
  validateRequestedProperties,
  validateRequiredQueryParams,
} from '../../src/utils/validators.ts';
import fixtureConfig from '../fixtures/fixture-config.json' with { type: 'json' };

const mockReqRes = (query: Record<string, string | undefined>) => {
  const response = {
    status: vi.fn(),
    send: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return {
    req: { query } as unknown as Request,
    res: response as unknown as Response,
  };
};

describe('validateRequiredQueryParams', () => {
  it('reports every missing parameter', () => {
    const { req, res } = mockReqRes({ gene: 'crt' });

    expect(validateRequiredQueryParams(req, res, ['gene', 'mutation', 'properties'])).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
      error: 'Missing required query parameters: mutation, properties',
    });
  });

  it('accepts a request containing every required parameter', () => {
    const { req, res, } = mockReqRes({ gene: 'crt', mutation: '76K' });

    expect(validateRequiredQueryParams(req, res, ['gene', 'mutation'])).toBe(true);
    expect(res.send).not.toHaveBeenCalled();
  });
});

describe('validateRequestedProperties', () => {
  const available = { admin1: 'VARCHAR', median: 'DOUBLE' };

  it('requires at least one property', () => {
    const { res, } = mockReqRes({});

    expect(validateRequestedProperties({}, ['admin1', 'median'], available, res)).toBeNull();
    expect(res.send).toHaveBeenCalledWith({ error: 'At least one property must be requested.' });
  });

  it('rejects a property outside the endpoint allow-list', () => {
    const { res, } = mockReqRes({});

    expect(validateRequestedProperties(
      { properties: 'admin1,secret' },
      ['admin1', 'median'],
      { ...available, secret: 'VARCHAR' },
      res,
    )).toBeNull();
    expect(res.send).toHaveBeenCalledWith({ error: 'Invalid property requested: secret' });
  });

  it('rejects an allowed property absent from the parquet file', () => {
    const { res, } = mockReqRes({});

    expect(validateRequestedProperties(
      { properties: 'admin1,median' },
      ['admin1', 'median'],
      { admin1: 'VARCHAR' },
      res,
    )).toBeNull();
    expect(res.send).toHaveBeenCalledWith({ error: 'Invalid property requested: median' });
  });

  it('returns the requested property list', () => {
    const { res } = mockReqRes({});

    expect(validateRequestedProperties(
      { properties: 'admin1,median' },
      ['admin1', 'median'],
      available,
      res,
    )).toEqual(['admin1', 'median']);
  });
});

describe('release validators', () => {
  it('accepts the default model release', () => {
    const { res } = mockReqRes({});
    expect(validateModelRelease("2026.05.08", res)).toBe(true);
  });

  it('rejects an unknown model release', () => {
    const { res } = mockReqRes({ model_release: '../private' });

    expect(validateModelRelease("../private", res)).toBe(false);
    expect(res.send).toHaveBeenCalledWith({ error: 'Invalid model release: ../private' });
  });

  it('accepts a known data release', () => {
    const { req, res } = mockReqRes({ data_release: fixtureConfig.dataRelease });
    expect(validateDataRelease(req, res)).toBe(true);
  });

  it('rejects an unknown data release', () => {
    const { req, res } = mockReqRes({ data_release: '../private' });

    expect(validateDataRelease(req, res)).toBe(false);
    expect(res.send).toHaveBeenCalledWith({
      error: 'Invalid data release requested: ../private',
    });
  });
});

describe('validateDateParams', () => {
  it.each(['date', 'date_from', 'date_to'])('rejects an invalid %s format', (parameter) => {
    const { req, res } = mockReqRes({ [parameter]: '01-05-2024' });

    expect(validateDateParams(req, res)).toBe(false);
    expect(res.send).toHaveBeenCalledWith({
      error: `Invalid date format for parameter '${parameter}'. Expected YYYY-MM-DD.`,
    });
  });

  it('requires date_to with date_from', () => {
    const { req, res } = mockReqRes({ date_from: '2024-01-01' });

    expect(validateDateParams(req, res)).toBe(false);
    expect(res.send).toHaveBeenCalledWith({
      error: "Missing required parameter 'date_to' when 'date_from' is specified.",
    });
  });

  it('requires date_from with date_to', () => {
    const { req, res } = mockReqRes({ date_to: '2024-01-01' });

    expect(validateDateParams(req, res)).toBe(false);
    expect(res.send).toHaveBeenCalledWith({
      error: "Missing required parameter 'date_from' when 'date_to' is specified.",
    });
  });

  it('rejects a reversed date range', () => {
    const { req, res } = mockReqRes({
      date_from: '2025-01-01',
      date_to: '2024-01-01',
    });

    expect(validateDateParams(req, res)).toBe(false);
    expect(res.send).toHaveBeenCalledWith({
      error: "'date_from' cannot be later than 'date_to'.",
    });
  });

  it('accepts a valid date range', () => {
    const { req, res } = mockReqRes({
      date_from: '2024-01-01',
      date_to: '2025-01-01',
    });
    expect(validateDateParams(req, res)).toBe(true);
  });
});

describe('validateDateIsFirstOfMonth', () => {
  it('accepts the first day of a month', () => {
    const { req, res } = mockReqRes({ date: '2024-05-01' });
    expect(validateDateIsFirstOfMonth(req, res)).toBe(true);
  });

  it('rejects any other day', () => {
    const { req, res } = mockReqRes({ date: '2024-05-02' });

    expect(validateDateIsFirstOfMonth(req, res)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('validateAdminLevel', () => {
  it('requires admin_level', () => {
    const { req, res } = mockReqRes({});

    expect(validateAdminLevel(req, res)).toBe(false);
    expect(res.send).toHaveBeenCalledWith({
      error: 'Missing required query parameter: admin_level',
    });
  });

  it('rejects an unsupported admin level', () => {
    const { req, res } = mockReqRes({ admin_level: '3' });

    expect(validateAdminLevel(req, res)).toBe(false);
    expect(res.send).toHaveBeenCalledWith({ error: 'Invalid admin level requested: 3' });
  });

  it('rejects a containing region more granular than the results', () => {
    const { req, res } = mockReqRes({
      admin_level: '1',
      admin2: 'MLI.1.1_1',
    });

    expect(validateAdminLevel(req, res)).toBe(false);
    expect(res.send).toHaveBeenCalledWith({
      error: 'You cannot request results at a less granular level than that of the containing region.',
    });
  });

  it('accepts a valid level and containing region', () => {
    const { req, res } = mockReqRes({ admin_level: '2', admin1: 'MLI.1_1' });
    expect(validateAdminLevel(req, res)).toBe(true);
  });
});

describe('validateAdmin0', () => {
  it('rejects a malformed ISO code', () => {
    const { req, res } = mockReqRes({ admin0: 'Mali' });

    expect(validateAdmin0(req, res)).toBe(false);
    expect(res.send).toHaveBeenCalledWith({
      error: "Invalid ISO code for parameter 'admin0'. Expected a 3-letter uppercase ISO code.",
    });
  });

  it('accepts a three-letter uppercase ISO code', () => {
    const { req, res } = mockReqRes({ admin0: 'MLI' });
    expect(validateAdmin0(req, res)).toBe(true);
  });
});
