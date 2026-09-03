// WHERE I GOT UP TO - reviewing changes/tests as far down as this file

import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeParquetQuery } from '../../src/utils/data.ts';
import fixtureConfig from '../fixtures/fixture-config.json' with { type: 'json' };

const db = vi.hoisted(() => ({
  bind: vi.fn(),
  prepare: vi.fn(),
  runAndReadAll: vi.fn(),
}));

vi.mock('../../src/queryEngine.ts', () => ({
  connection: {
    prepare: db.prepare,
    runAndReadAll: db.runAndReadAll,
  }
}));

const admin1ParquetPath = `tests/fixtures/data/model/${fixtureConfig.modelRelease}/admin1.parquet`;
const surveyPath = `tests/fixtures/data/stave/${fixtureConfig.dataRelease}/survey_data.parquet`;
const columnsTypes = {
  admin1: 'VARCHAR',
  gene: 'VARCHAR',
  mutation: 'VARCHAR',
  date: 'DATE',
  collection_day: 'DATE',
  median: 'DOUBLE',
  no_of_informing_surveys: 'INTEGER',
  survey_id: 'VARCHAR',
  lat: 'DOUBLE',
  lng: 'DOUBLE',
};

const mockResponse = () => {
  const response = {
    status: vi.fn(),
    send: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response as unknown as Response;
};

beforeEach(() => {
  vi.clearAllMocks();
  db.runAndReadAll.mockResolvedValue({
    columnNames: () => Object.keys(columnsTypes),
    columnTypes: () => Object.values(columnsTypes),
  });
  db.prepare.mockResolvedValue(db);
});

describe('executeParquetQuery SQL generation', () => {
  it('uses equality filters and SQL parameter bindings', async () => {
    const response = mockResponse();

    await executeParquetQuery(
      {
        properties: 'admin1,median',
        gene: 'crt',
        mutation: '76K',
        date: '2024-05-01',
      },
      '/prevalences',
      admin1ParquetPath,
      response,
    );

    expect(db.prepare).toHaveBeenCalledWith(
      `SELECT p.admin1, ROUND(p.median, 4) AS median FROM '${admin1ParquetPath}' p ` +
      'WHERE p.gene = $gene AND p.mutation = $mutation AND p.date = $date',
    );
    expect(db.bind).toHaveBeenCalledWith({
      gene: 'crt',
      mutation: '76K',
      date: '2024-05-01',
    });
  });

  it('maps date ranges to the `date` column for the prevalences endpoint, using inequality operators', async () => {
    const response = mockResponse();

    await executeParquetQuery(
      {
        properties: 'admin1',
        date_from: '2023-05-01',
        date_to: '2025-05-01',
      },
      '/prevalences',
      admin1ParquetPath,
      response,
    );

    expect(db.prepare).toHaveBeenCalledWith(
      `SELECT p.admin1 FROM '${admin1ParquetPath}' p ` +
      'WHERE p.date >= $date_from AND p.date <= $date_to',
    );
    expect(db.bind).toHaveBeenCalledWith({
      date_from: '2023-05-01',
      date_to: '2025-05-01',
    });
  });

  it('maps date ranges to the `collection_day` column for the surveys endpoint, using inequality operators', async () => {
    const response = mockResponse();

    await executeParquetQuery(
      {
        properties: 'gene',
        date_from: '2023-05-01',
        date_to: '2025-05-01',
      },
      '/surveys',
      admin1ParquetPath,
      response,
    );

    expect(db.prepare).toHaveBeenCalledWith(
      `SELECT p.gene FROM '${admin1ParquetPath}' p ` +
      'WHERE p.collection_day >= $date_from AND p.collection_day <= $date_to',
    );
    expect(db.bind).toHaveBeenCalledWith({
      date_from: '2023-05-01',
      date_to: '2025-05-01',
    });
  });

  it('filters prevalence admin0 using the parquet column', async () => {
    const response = mockResponse();

    await executeParquetQuery(
      { properties: 'admin1', admin0: 'MLI' },
      '/prevalences',
      admin1ParquetPath,
      response,
    );

    expect(db.prepare).toHaveBeenCalledWith(
      `SELECT p.admin1 FROM '${admin1ParquetPath}' p WHERE p.admin0 = $admin0`,
    );
    expect(db.bind).toHaveBeenCalledWith({ admin0: 'MLI' });
  });

  it('expands survey admin0 into latitude and longitude bounds', async () => {
    const response = mockResponse();

    await executeParquetQuery(
      { properties: 'survey_id', admin0: 'MLI', date_from: '2010-01-01', date_to: '2010-02-01' },
      '/surveys',
      surveyPath,
      response,
    );

    expect(db.prepare).toHaveBeenCalledWith(
      `SELECT p.survey_id FROM '${surveyPath}' p WHERE ` +
      'p.lat >= 10.1595 AND p.lat <= 25 AND p.lng >= -12.2389 AND p.lng <= 4.245 ' +
      'AND p.collection_day >= $date_from AND p.collection_day <= $date_to',
    );
    expect(db.bind).toHaveBeenCalledWith({
      date_from: '2010-01-01',
      date_to: '2010-02-01',
    });
  });

  it('sends a 400 after getting an unknown ISO code', async () => {
    const response = mockResponse();

    const result = await executeParquetQuery(
      { properties: 'survey_id', admin0: 'ZZZ' },
      '/surveys',
      surveyPath,
      response,
    );

    expect(result).toBeUndefined();
    expect(response.send).toHaveBeenCalledWith({ error: 'ISO code not found: ZZZ' });
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('omits WHERE when no filterable parameters are provided', async () => {
    const response = mockResponse();

    await executeParquetQuery(
      { properties: 'admin1' },
      '/prevalences',
      admin1ParquetPath,
      response,
    );

    expect(db.prepare).toHaveBeenCalledWith(
      `SELECT p.admin1 FROM '${admin1ParquetPath}' p `,
    );
    expect(db.bind).toHaveBeenCalledWith({});
  });

  it('rounds floating-point columns', async () => {
    const response = mockResponse();

    await executeParquetQuery(
      { properties: 'median,no_of_informing_surveys' },
      '/prevalences',
      admin1ParquetPath,
      response,
    );

    expect(db.prepare).toHaveBeenCalledWith(
      `SELECT ROUND(p.median, 4) AS median, p.no_of_informing_surveys FROM '${admin1ParquetPath}' p `,
    );
  });

  it('rejects a requested property if it belongs to a different parquet schema', async () => {
    const response = mockResponse();

    const result = await executeParquetQuery(
      { properties: 'admin2' },
      '/prevalences',
      admin1ParquetPath,
      response,
    );

    expect(result).toBeUndefined();
    expect(response.send).toHaveBeenCalledWith({ error: 'Invalid property requested: admin2' });
    expect(db.prepare).not.toHaveBeenCalled();
  });
});
