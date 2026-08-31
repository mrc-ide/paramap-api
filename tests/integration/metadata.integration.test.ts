import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import fixtureConfig from '../fixtures/fixture-config.json' with { type: 'json' };

const app = createApp();

describe('GET /metadata', () => {
  it('returns metadata for the latest model release by default', async () => {
    const response = await request(app).get('/metadata');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      model_releases: [fixtureConfig.modelRelease],
      prevalences: {
        version: fixtureConfig.modelRelease,
        data_release: fixtureConfig.dataRelease,
      },
      bounds: {
        min: { lng: -70.0635, lat: 12.4124 },
        max: { lng: -69.8654, lat: 12.624 },
      },
    });

    const expectedVariants = [
      {
        gene: 'crt',
        mutations: [{
          mutation: '76K',
          date_range: { start: '2023-05-01', end: '2025-05-01' },
        }],
      },
      {
        gene: 'k13',
        mutations: [{
          mutation: '469Y',
          date_range: { start: '2024-05-01', end: '2025-05-01' },
        }],
      },
    ];
    expect(response.body.prevalences.variants).toHaveLength(expectedVariants.length);
    expect(response.body.prevalences.variants).toEqual(expect.arrayContaining(expectedVariants));
  });

  it('accepts an explicit model release', async () => {
    const response = await request(app)
      .get('/metadata')
      .query({ model_release: fixtureConfig.modelRelease });

    expect(response.status).toBe(200);
    expect(response.body.prevalences.version).toBe(fixtureConfig.modelRelease);
    expect(response.body.prevalences.data_release).toBe(fixtureConfig.dataRelease);
  });

  it('rejects an unknown model release', async () => {
    const response = await request(app)
      .get('/metadata')
      .query({ model_release: '../private' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid model release: ../private' });
  });
});
