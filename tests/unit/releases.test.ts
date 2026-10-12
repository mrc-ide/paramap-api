import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { getDataRelease, getModelRelease } from '../../src/utils/releases.ts';

vi.mock('../../src/constants.ts', () => ({
  modelVersions: ['v0.1.0', 'v0.9.0', 'v0.10.0'],
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(JSON.stringify({ data_release: 'v1.2.3' })),
}));

describe('getModelRelease', () => {
  it('defaults to v0.10.0 rather than v0.9.0 using semantic-version order', () => {
    const req = { query: {} } as Request;

    expect(getModelRelease(req)).toBe('v0.10.0');
  });

  it('uses an explicitly requested release instead of the latest release', () => {
    const req = { query: { model_release: 'v0.9.0' } } as unknown as Request;

    expect(getModelRelease(req)).toBe('v0.9.0');
  });
});

describe('getDataRelease', () => {
  it('defaults to the data release specified in the latest model metadata', () => {
    const req = { query: {} } as Request;

    expect(getDataRelease(req)).toBe('v1.2.3');
  });

  it('uses an explicitly requested release instead of the default data release', () => {
    const req = { query: { data_release: 'v9.9.9' } } as unknown as Request;

    expect(getDataRelease(req)).toBe('v9.9.9');
  });
});
