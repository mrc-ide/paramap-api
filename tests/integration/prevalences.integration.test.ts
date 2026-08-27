import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';

const app = createApp();
const baseQuery = {
  model_release: '2026.05.08',
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
    expect(response.body).toEqual({
      admin1: ['MLI.1_1', 'MLI.2_1', 'ETH.1_1', 'ETH.2_1'],
      median: [0.5647, 0.5847, 0.6647, 0.6847],
    });
  });

  it.each([
    { from: '2023-05-01', expectedRows: 12, includesHistoric: false },
    { from: '2003-05-01', expectedRows: 16, includesHistoric: true },
  ])('returns the requested global date range from $from', async ({
    from,
    expectedRows,
    includesHistoric,
  }) => {
    const response = await request(app)
      .get('/prevalences')
      .query({
        ...baseQuery,
        date_from: from,
        date_to: '2025-05-01',
        properties: 'admin1,median,date',
      });

    expect(response.status).toBe(200);
    expect(response.body.admin1).toHaveLength(expectedRows);
    expect(response.body.date.includes('2003-05-01')).toBe(includesHistoric);
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
      median: [0.5647],
      mean: [0.5747],
      lower_95: [0.4647],
      upper_95: [0.6647],
      SD: [0.02],
      exceedance_1: [0.9],
      exceedance_2: [0.8],
      exceedance_5: [0.7],
      exceedance_10: [0.6],
      no_of_informing_surveys: [2],
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
    expect(response.body).toEqual({
      median: [0.5647, 0.5847],
      admin1: ['MLI.1_1', 'MLI.2_1'],
    });
  });

  it.each([
    { from: '2023-05-01', expectedRows: 12 },
    { from: '2003-05-01', expectedRows: 16 },
  ])('reads admin2 data for a country from $from', async ({ from, expectedRows }) => {
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
    expect(response.body.admin1).toHaveLength(expectedRows);
    expect(response.body.median).toHaveLength(expectedRows);
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
    expect(response.body.date).toEqual([
      '2003-05-01',
      '2023-05-01',
      '2024-05-01',
      '2025-05-01',
    ]);
    expect(response.body.median).toEqual([0.2, 0.4, 0.5647, 0.7]);
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
