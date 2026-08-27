import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';

const app = createApp();
const baseQuery = {
  data_release: '2026.03.17',
  gene: 'crt',
  mutation: '76K',
};
const pointProperties = 'survey_id,lat,lng,collection_day,denominator';

describe('GET /surveys', () => {
  it('returns global survey points within a date range', async () => {
    const response = await request(app)
      .get('/surveys')
      .query({
        ...baseQuery,
        date_from: '2010-01-01',
        date_to: '2010-02-01',
        properties: pointProperties,
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        survey_id: 's0001_Bamako',
        lat: 12.6129,
        lng: -8.1356,
        collection_day: '2010-01-15',
        denominator: 170,
      },
      {
        survey_id: 's0002_Gondar_Zuria',
        lat: 12.6,
        lng: 37.5,
        collection_day: '2010-01-20',
        denominator: 100,
      },
    ]);
  });

  it('returns additional surveys for a wide lazy-loading range', async () => {
    const response = await request(app)
      .get('/surveys')
      .query({
        ...baseQuery,
        date_from: '2000-01-01',
        date_to: '2030-02-01',
        properties: pointProperties,
      });

    expect(response.status).toBe(200);
    expect(response.body.map((survey: { survey_id: string }) => survey.survey_id)).toEqual([
      's0001_Bamako',
      's0002_Gondar_Zuria',
      's0003_Historic_Mali',
      's0004_Future_ETH',
    ]);
  });

  it('returns the requested details for a single survey', async () => {
    const response = await request(app)
      .get('/surveys')
      .query({
        ...baseQuery,
        survey_id: 's0002_Gondar_Zuria',
        properties: [
          'lat',
          'lng',
          'site_name',
          'collection_day',
          'collection_start',
          'collection_end',
          'study_label',
          'reference_year',
          'numerator',
          'denominator',
          'prevalence',
          'prevalence_lower',
          'prevalence_upper',
        ].join(','),
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{
      lat: 12.6,
      lng: 37.5,
      site_name: 'Gondar Zuria',
      collection_day: '2010-01-20',
      collection_start: '2010-01-01',
      collection_end: '2010-01-31',
      study_label: 'Gondar Zuria study',
      reference_year: 2017,
      numerator: 40,
      denominator: 100,
      prevalence: 40,
      prevalence_lower: 30,
      prevalence_upper: 50,
    }]);
  });

  it('filters country survey points using the country bounding box', async () => {
    const response = await request(app)
      .get('/surveys')
      .query({
        ...baseQuery,
        admin0: 'MLI',
        date_from: '2010-01-01',
        date_to: '2010-02-01',
        properties: pointProperties,
      });

    expect(response.status).toBe(200);
    expect(response.body.map((survey: { survey_id: string }) => survey.survey_id)).toEqual([
      's0001_Bamako',
    ]);
  });

  it('returns all in-country surveys in a wide lazy-loading range', async () => {
    const response = await request(app)
      .get('/surveys')
      .query({
        ...baseQuery,
        admin0: 'MLI',
        date_from: '2000-01-01',
        date_to: '2030-02-01',
        properties: pointProperties,
      });

    expect(response.status).toBe(200);
    expect(response.body.map((survey: { survey_id: string }) => survey.survey_id)).toEqual([
      's0001_Bamako',
      's0003_Historic_Mali',
    ]);
  });

  it('rejects an ISO code absent from the bounds metadata', async () => {
    const response = await request(app)
      .get('/surveys')
      .query({
        ...baseQuery,
        admin0: 'ZZZ',
        properties: 'survey_id',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'ISO code not found: ZZZ' });
  });

  it('rejects an unknown data release', async () => {
    const response = await request(app)
      .get('/surveys')
      .query({
        ...baseQuery,
        data_release: '../private',
        properties: 'survey_id',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Invalid data release requested: ../private',
    });
  });
});
