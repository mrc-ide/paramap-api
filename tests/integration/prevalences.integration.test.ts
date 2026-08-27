import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import fixtureConfig from '../fixtures/fixture-config.json' with { type: 'json' };

const app = createApp();
const baseQuery = {
  model_release: fixtureConfig.modelRelease,
  admin_level: '1',
  gene: 'crt',
  mutation: '76K',
};

describe('GET /prevalences', () => {
  it('returns per-region medians for a global single-date view', async () => {
    const response = await request(app)
      .get('/prevalences')
      .query({
        ...baseQuery,
        date: '2024-05-01',
        properties: 'admin1,median',
      });

    expect(response.status).toBe(200);
    const rows = response.body.admin1.map((admin1: string, index: number) => ({
      admin1,
      median: response.body.median[index],
    }));
    expect(rows).toHaveLength(20);
    expect(rows).toEqual(expect.arrayContaining([
      { admin1: 'MLI.1_1', median: 0.0745 },
      { admin1: 'ETH.8_1', median: 0.6524 },
    ]));
  });

  it.each([
    '2023-05-01',
    '2003-05-01',
  ])('returns the available global date range when requested from %s', async (from) => {
    const response = await request(app)
      .get('/prevalences')
      .query({
        ...baseQuery,
        date_from: from,
        date_to: '2025-05-01',
        properties: 'admin1,median,date',
      });

    expect(response.status).toBe(200);
      expect(response.body.admin1).toHaveLength(500);
      expect(response.body.date).toContain('2023-05-01');
      expect(response.body.date).toContain('2025-05-01');
      expect(response.body.date).not.toContain('2003-05-01');
  });

  it('returns the full on-hover details for one region', async () => {
    const response = await request(app)
      .get('/prevalences')
      .query({
        ...baseQuery,
        admin1: 'MLI.1_1',
        date: '2024-05-01',
        properties: [
          'median',
          'mean',
          'lower_95',
          'upper_95',
          'SD',
          'exceedance_1',
          'exceedance_2',
          'exceedance_5',
          'exceedance_10',
          'no_of_informing_surveys',
        ].join(','),
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      median: [0.0745],
      mean: [0.0908],
      lower_95: [0],
      upper_95: [0.1979],
      SD: [0.0546],
      exceedance_1: [0.9305],
      exceedance_2: [0.9026],
      exceedance_5: [0.7725],
      exceedance_10: [0.4334],
      no_of_informing_surveys: [32],
    });
  });

  it('scopes an admin1 view to a country', async () => {
    const response = await request(app)
      .get('/prevalences')
      .query({
        ...baseQuery,
        admin0: 'MLI',
        date: '2024-05-01',
        properties: 'median,admin1',
      });

    expect(response.status).toBe(200);
      const rows = response.body.admin1.map((admin1: string, index: number) => ({
        admin1,
        median: response.body.median[index],
      }));
      expect(rows).toHaveLength(9);
      expect(rows).toEqual(expect.arrayContaining([
        { admin1: 'MLI.1_1', median: 0.0745 },
        { admin1: 'MLI.8_1', median: 0.6369 },
      ]));
  });

  it.each([
      '2023-05-01',
      '2003-05-01',
  ])('reads all available admin2 country data when requested from %s', async (from) => {
    const response = await request(app)
      .get('/prevalences')
      .query({
        ...baseQuery,
        admin_level: '2',
        admin0: 'MLI',
        date_from: from,
        date_to: '2025-05-01',
        properties: 'admin1,median,date',
      });

    expect(response.status).toBe(200);
    expect(response.body.admin1).toHaveLength(1250);
    expect(response.body.median).toHaveLength(1250);
  });

  it('returns an unbounded time series when date parameters are omitted', async () => {
    const response = await request(app)
      .get('/prevalences')
      .query({
        ...baseQuery,
        admin_level: '0',
        admin0: 'MLI',
        properties: 'date,median,lower_95,upper_95',
      });

    expect(response.status).toBe(200);
    const rows = response.body.date.map((date: string, index: number) => ({
      date,
      median: response.body.median[index],
    }));
    expect(rows).toHaveLength(25);
    expect(rows).toEqual(expect.arrayContaining([
      { date: '2023-05-01', median: 0.476 },
      { date: '2024-05-01', median: 0.287 },
      { date: '2025-05-01', median: 0.214 },
    ]));
  });

  it('reports missing required parameters', async () => {
    const response = await request(app)
      .get('/prevalences')
      .query({ admin_level: '1' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe(
      'Missing required query parameters: model_release, gene, mutation, properties',
    );
  });

  it('rejects a containing region more granular than the requested results', async () => {
    const response = await request(app)
      .get('/prevalences')
      .query({
        ...baseQuery,
        admin2: 'MLI.1.1_1',
        properties: 'admin1',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/less granular level/);
  });

  it('rejects an invalid requested property', async () => {
    const response = await request(app)
      .get('/prevalences')
      .query({
        ...baseQuery,
        date: '2024-05-01',
        properties: 'admin1,password',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid property requested: password' });
  });
});
