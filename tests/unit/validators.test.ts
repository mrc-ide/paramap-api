import type { Request } from 'express';
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
      dateFormat: "YYYY-MM-DD"
    },
    '/test-month': {
      requiredParams: ['gene', 'mutation', 'properties'],
      dateFormat: "YYYY-MM"
    },
  },
}));

const mockReq = (query: Record<string, string | undefined>, path = '/test') => {
  return { path, query } as unknown as Request;
};

describe('validateRequiredQueryParams', () => {
  it('reports every missing parameter', () => {
    const req = mockReq({ gene: 'crt', mutation: '', properties: undefined });

    expect(() => validateRequiredQueryParams(req)).toThrow('Missing required query parameters: mutation, properties');
  });

  it('accepts a request containing every required parameter', () => {
    const req = mockReq({
      gene: 'crt',
      mutation: '76K',
      properties: 'gene',
    });

    expect(() => validateRequiredQueryParams(req)).not.toThrow();
  });
});

describe('validateRequestedProperties', () => {
  const dbTypes = { admin1: 'VARCHAR', median: 'DOUBLE' };

  it('requires at least one property', () => {
    expect(
      () => validateRequestedProperties([], ['admin1', 'median'], dbTypes)
    ).toThrow('At least one property must be requested');
  });

  it('rejects a property outside the endpoint allow-list', () => {
    expect(
      () => validateRequestedProperties(['admin1', 'median'], ['median'], dbTypes)
    ).toThrow('Invalid property requested: admin1');
  });

  it('rejects an allowed property absent from the parquet file', () => {
    expect(
      () => validateRequestedProperties(['median'], ['median'], {})
    ).toThrow('Invalid property requested: median');
  });

  it('returns true if the requested property list is valid', () => {
    expect(
      () => validateRequestedProperties(['admin1', 'median'], ['admin1', 'median'], dbTypes)
    ).not.toThrow();
  });
});

describe('release validators', () => {
  it('accepts a known model release', () => {
    const req = mockReq({ model_release: fixtureConfig.modelRelease });
    expect(() => validateModelRelease(req)).not.toThrow();
  });

  it('accepts a missing model release by falling back to the default', () => {
    const req = mockReq({});
    expect(() => validateModelRelease(req)).not.toThrow();
  });

  it('rejects an unknown model release', () => {
    const req = mockReq({ model_release: '../private' });

    expect(() => validateModelRelease(req)).toThrow('Unknown model release: ../private');
  });

  it('accepts a known data release', () => {
    const req = mockReq({ data_release: fixtureConfig.dataRelease });
    expect(() => validateDataRelease(req)).not.toThrow();
  });

  it('accepts a missing data release by falling back to the default', () => {
    const req = mockReq({});
    expect(() => validateDataRelease(req)).not.toThrow();
  });

  it('rejects an unknown data release', () => {
    const req = mockReq({ data_release: '../private' });

    expect(() => validateDataRelease(req)).toThrow('Unknown data release requested: ../private');
  });
});

describe('validateDateParams', () => {
  it.each(['date', 'date_from', 'date_to'])('rejects an invalid %s format', (parameter) => {
    const req = mockReq({ [parameter]: '2025-01' });

    expect(() => validateDateParams(req)).toThrow(`Invalid date for parameter '${parameter}'. Expected YYYY-MM-DD.`);
  });

  it.each(['date', 'date_from', 'date_to'])('rejects an invalid date for %s', (parameter) => {
    const req = mockReq({ [parameter]: '2026-99-99' });

    expect(() => validateDateParams(req)).toThrow(`Invalid date for parameter '${parameter}'. Expected YYYY-MM-DD.`);
  });

  it.each(['date_from', 'date_to'])('does not requires %s with the other date range parameter', (parameter) => {
    const req = mockReq({ [parameter]: '2024-01-01' });

    expect(() => validateDateParams(req)).not.toThrow();
  });

  it('rejects when date_from is later than date_to', () => {
    const req = mockReq({
      date_from: '2025-01-01',
      date_to: '2024-01-01',
    });

    expect(() => validateDateParams(req)).toThrow(`'date_from' cannot be later than 'date_to'.`);
  });

  it('accepts a valid date range', () => {
    const req = mockReq({
      date_from: '2024-01-01',
      date_to: '2025-01-01',
    });
    expect(() => validateDateParams(req)).not.toThrow();
  });
});

describe('validateDateParams for monthly date format', () => {
  it.each(['date', 'date_from', 'date_to'])('rejects an invalid %s format', (parameter) => {
    const req = mockReq({ [parameter]: '2024-05-01' }, '/test-month');

    expect(() => validateDateParams(req)).toThrow(`Invalid date for parameter '${parameter}'. Expected YYYY-MM.`);
  });

  it.each(['date', 'date_from', 'date_to'])('rejects an invalid date for %s', (parameter) => {
    const req = mockReq({ [parameter]: '2026-99' }, '/test-month');

    expect(() => validateDateParams(req)).toThrow(`Invalid date for parameter '${parameter}'. Expected YYYY-MM.`);
  });

  it('rejects when date_from is later than date_to', () => {
    const req = mockReq({
      date_from: '2025-01',
      date_to: '2024-01',
    }, '/test-month');

    expect(() => validateDateParams(req)).toThrow(`'date_from' cannot be later than 'date_to'.`);
  });

  it('accepts a valid date range', () => {
    const req = mockReq({
      date_from: '2024-01',
      date_to: '2025-01',
    }, '/test-month');
    expect(() => validateDateParams(req)).not.toThrow();
  });
});

describe('validateAdminLevel', () => {
  it('requires admin_level to be present', () => {
    const req = mockReq({});

    expect(() => validateAdminLevel(req)).toThrow("Invalid admin level requested: undefined");
  });

  it('requires admin_level to be non-empty', () => {
    const req = mockReq({ admin_level: '' });

    expect(() => validateAdminLevel(req)).toThrow("Invalid admin level requested: ");
  });

  it('rejects an unsupported admin level', () => {
    const req = mockReq({ admin_level: '3' });

    expect(() => validateAdminLevel(req)).toThrow("Invalid admin level requested: 3");
  });

  it('rejects a containing region more granular than the results', () => {
    const req = mockReq({
      admin_level: '1',
      admin2: 'MLI.1.1_1',
    });

    expect(() => validateAdminLevel(req)).toThrow("You cannot request results at a less granular level than that of the containing region.");
  });

  it('accepts a valid level and containing region', () => {
    const req = mockReq({ admin_level: '2', admin1: 'MLI.1_1' });
    expect(() => validateAdminLevel(req)).not.toThrow();
  });
});
