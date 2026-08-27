import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import fixtureConfig from '../fixtures/fixture-config.json' with { type: 'json' };

const app = createApp();
const baseQuery = {
  data_release: fixtureConfig.dataRelease,
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
    expect(response.body).toHaveLength(2);
    expect(response.body).toEqual(expect.arrayContaining([
      {
        survey_id: 's0006_kisii_period2',
        lat: -0.6805,
        lng: 34.7771,
        collection_day: '2010-01-01',
        denominator: 5,
      },
      {
        survey_id: 's0136_Bunkpurugu_period1',
        lat: 10.5418,
        lng: -0.1739,
        collection_day: '2010-01-01',
        denominator: 72,
      },
    ]));
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
    const surveyIds = response.body.map((survey: { survey_id: string }) => survey.survey_id);
    expect(surveyIds).toHaveLength(4);
    expect(surveyIds).toEqual(expect.arrayContaining(fixtureConfig.surveyIds));
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
      lat: 12.6739,
      lng: 37.3435,
      site_name: 'Gondar Zuria',
      collection_day: '2022-07-02',
      collection_start: '2022-01-01',
      collection_end: '2023-01-01',
      study_label: 'Artemisinin resistant kelch13 R622I and RDT negativity approaching predominance in northern Ethiopia and emerging C580Y of African origin threaten falciparum malaria control.',
      reference_year: 2025,
      numerator: 75,
      denominator: 438,
      prevalence: 17.1233,
      prevalence_lower: 13.7134,
      prevalence_upper: 20.9845,
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
      's0136_Bunkpurugu_period1',
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
    const surveyIds = response.body.map((survey: { survey_id: string }) => survey.survey_id);
    expect(surveyIds).toHaveLength(2);
    expect(surveyIds).toEqual(expect.arrayContaining([
      'WWARN_16154388_mali_1998',
      's0136_Bunkpurugu_period1',
    ]));
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
