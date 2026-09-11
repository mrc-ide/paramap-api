import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.ts';
import { connection } from '../../src/queryEngine.ts';
import fixtureConfig from '../fixtures/fixture-config.json' with { type: 'json' };

const app = createApp();

describe('error handling middleware', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a 500 response when a route handler throws unexpectedly', async () => {
    vi.spyOn(connection, 'runAndReadAll').mockRejectedValueOnce(new Error('DuckDB exploded'));

    const response = await request(app)
      .get('/metadata')
      .query({ model_release: fixtureConfig.modelRelease });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'DuckDB exploded' });
  });

  it('falls back to a generic message when the error has none', async () => {
    vi.spyOn(connection, 'runAndReadAll').mockRejectedValueOnce(
      Object.assign(new Error(), { message: '' }),
    );

    const response = await request(app)
      .get('/metadata')
      .query({ model_release: fixtureConfig.modelRelease });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Internal Server Error' });
  });
});
