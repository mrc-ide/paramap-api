import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import fixtureConfig from '../fixtures/fixture-config.json' with { type: 'json' };

const app = createApp();
const baseQuery = {
  model_release: fixtureConfig.modelRelease,
  gene: 'crt',
  mutation: '76K',
};

describe('GET /prevalences', () => {
  it('returns per-region info for a global single-date view', async () => {
    const response = await request(app)
      .get('/prevalences')
      .query({
        ...baseQuery,
        admin_level: '0',
        date: '2024-05-01',
        properties: 'admin0,median',
      });

    expect(response.status).toBe(200);
    expect(response.body.admin0).toStrictEqual(['ETH', 'MLI']);
    expect(response.body.median).toStrictEqual([
      expect.closeTo(0.20),
      expect.closeTo(0.29),
    ]);
  });

  it('returns results within a range of dates', async () => {
    const response = await request(app)
      .get('/prevalences')
      .query({
        ...baseQuery,
        admin_level: '0',
        date_from: '2024-06-01',
        date_to: '2025-01-01',
        properties: 'admin0,median,date',
      });

    expect(response.status).toBe(200);
    const expectedLength = 2 * 8; // 2 admin0 regions * 8 months in the date range
    expect(response.body.admin0).toHaveLength(expectedLength);
    expect(response.body.median).toHaveLength(expectedLength);
    expect(response.body.date).toHaveLength(expectedLength);
    expect(response.body.date).toContain('2024-06-01');
    expect(response.body.date).toContain('2025-01-01');
    expect(response.body.date).not.toContain('2023-01-01');
    expect(response.body.date).not.toContain('2026-01-01');
  });

  it('returns details for one region', async () => {
    const response = await request(app)
      .get('/prevalences')
      .query({
        ...baseQuery,
        admin_level: '1',
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
      median: [expect.closeTo(0.07)],
      mean: [expect.closeTo(0.09)],
      lower_95: [0],
      upper_95: [expect.closeTo(0.20)],
      SD: [expect.closeTo(0.05)],
      exceedance_1: [expect.closeTo(0.93)],
      exceedance_2: [expect.closeTo(0.90)],
      exceedance_5: [expect.closeTo(0.77)],
      exceedance_10: [expect.closeTo(0.43)],
      no_of_informing_surveys: [32],
    });
  });

  it('can scope an admin1-level request to an admin0 region', async () => {
    const response = await request(app)
      .get('/prevalences')
      .query({
        ...baseQuery,
        admin_level: '1',
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
      { admin1: 'MLI.1_1', median: expect.closeTo(0.07) },
      { admin1: 'MLI.8_1', median: expect.closeTo(0.64) },
    ]));
  });

  it('can scope an admin2-level request to an admin0 region', async () => {
    const response = await request(app)
      .get('/prevalences')
      .query({
        ...baseQuery,
        admin_level: '2',
        admin0: 'MLI',
        date: '2024-05-01',
        properties: 'median,admin2',
      });

    expect(response.status).toBe(200);
      const rows = response.body.admin2.map((admin2: string, index: number) => ({
        admin2,
        median: response.body.median[index],
      }));
      expect(rows).toHaveLength(50);
      expect(rows).toEqual(expect.arrayContaining([
        { admin2: 'MLI.1.1_1', median: expect.closeTo(0.12) },
        { admin2: 'MLI.8.1_1', median: expect.closeTo(0.40) },
      ]));
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
      { date: '2023-05-01', median: expect.closeTo(0.48) },
      { date: '2024-05-01', median: expect.closeTo(0.29) },
      { date: '2025-05-01', median: expect.closeTo(0.21) },
    ]));
  });

  it('reports missing required parameters', async () => {
    const response = await request(app)
      .get('/prevalences')
      .query({ admin_level: '1' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe(
      'Missing required query parameters: model_release, properties, gene, mutation',
    );
  });

  it('rejects a containing region more granular than the requested results', async () => {
    const response = await request(app)
      .get('/prevalences')
      .query({
        ...baseQuery,
        admin_level: '1',
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
        admin_level: '1',
        date: '2024-05-01',
        properties: 'admin1,password',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid property requested: password' });
  });
});
