import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  bind: vi.fn(),
  prepare: vi.fn(),
  runAndReadAll: vi.fn(),
  runPrepared: vi.fn(),
}));

vi.mock('../../src/queryEngine.ts', () => ({
  connection: {
    prepare: db.prepare,
    runAndReadAll: db.runAndReadAll,
  },
}));

import { executeParquetQuery } from '../../src/utils/dataHelpers.ts';
import fixtureConfig from '../fixtures/fixture-config.json' with { type: 'json' };

const parquetPath = `tests/fixtures/data/model/${fixtureConfig.modelRelease}/admin1.parquet`;
const columns = {
  admin0: 'VARCHAR',
  admin1: 'VARCHAR',
  gene: 'VARCHAR',
  mutation: 'VARCHAR',
  date: 'DATE',
  median: 'DOUBLE',
  no_of_informing_surveys: 'INTEGER',
};

const inspectResult = {
  columnNames: () => Object.keys(columns),
  columnTypes: () => Object.values(columns),
};

const mockResponse = () => {
  const response = {
    status: vi.fn(),
    send: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return { res: response as unknown as Response, response };
};

beforeEach(() => {
  vi.clearAllMocks();
  db.runAndReadAll.mockResolvedValue(inspectResult);
  db.runPrepared.mockResolvedValue({ result: true });
  db.prepare.mockResolvedValue({
    bind: db.bind,
    runAndReadAll: db.runPrepared,
  });
});

describe('executeParquetQuery SQL generation', () => {
  it('uses equality filters and parameter bindings', async () => {
    const { res } = mockResponse();

    await executeParquetQuery(
      {
        properties: 'admin1,median',
        gene: 'crt',
        mutation: '76K',
        date: '2024-05-01',
      },
      '/prevalences',
      parquetPath,
      res,
    );

    expect(db.prepare).toHaveBeenCalledWith(
      `SELECT p.admin1, ROUND(p.median, 4) AS median FROM '${parquetPath}' p ` +
      'WHERE p.gene = $gene AND p.mutation = $mutation AND p.date = $date',
    );
    expect(db.bind).toHaveBeenCalledWith({
      gene: 'crt',
      mutation: '76K',
      date: '2024-05-01',
    });
  });

  it('maps date ranges to the endpoint date column and comparison operators', async () => {
    const { res } = mockResponse();

    await executeParquetQuery(
      {
        properties: 'admin1',
        date_from: '2023-05-01',
        date_to: '2025-05-01',
      },
      '/prevalences',
      parquetPath,
      res,
    );

    expect(db.prepare).toHaveBeenCalledWith(
      `SELECT p.admin1 FROM '${parquetPath}' p ` +
      'WHERE p.date >= $date_from AND p.date <= $date_to',
    );
    expect(db.bind).toHaveBeenCalledWith({
      date_from: '2023-05-01',
      date_to: '2025-05-01',
    });
  });

  it('filters prevalence admin0 through the parquet column', async () => {
    const { res } = mockResponse();

    await executeParquetQuery(
      { properties: 'admin1', admin0: 'MLI' },
      '/prevalences',
      parquetPath,
      res,
    );

    expect(db.prepare).toHaveBeenCalledWith(
      `SELECT p.admin1 FROM '${parquetPath}' p WHERE p.admin0 = $admin0`,
    );
    expect(db.bind).toHaveBeenCalledWith({ admin0: 'MLI' });
  });

  it('expands survey admin0 into latitude and longitude bounds', async () => {
    const surveyPath = `tests/fixtures/data/stave/${fixtureConfig.dataRelease}/survey_data.parquet`;
    db.runAndReadAll.mockResolvedValue({
      columnNames: () => ['survey_id', 'lat', 'lng', 'collection_day'],
      columnTypes: () => ['VARCHAR', 'DOUBLE', 'DOUBLE', 'DATE'],
    });
    const { res } = mockResponse();

    await executeParquetQuery(
      { properties: 'survey_id', admin0: 'MLI', date_from: '2010-01-01', date_to: '2010-02-01' },
      '/surveys',
      surveyPath,
      res,
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

  it('returns null after reporting an unknown ISO code', async () => {
    const surveyPath = `tests/fixtures/data/stave/${fixtureConfig.dataRelease}/survey_data.parquet`;
    db.runAndReadAll.mockResolvedValue({
      columnNames: () => ['survey_id', 'lat', 'lng'],
      columnTypes: () => ['VARCHAR', 'DOUBLE', 'DOUBLE'],
    });
    const { res, response } = mockResponse();

    const result = await executeParquetQuery(
      { properties: 'survey_id', admin0: 'ZZZ' },
      '/surveys',
      surveyPath,
      res,
    );

    expect(result).toBeNull();
    expect(response.send).toHaveBeenCalledWith({ error: 'ISO code not found: ZZZ' });
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('omits WHERE and ignores non-filterable parameters', async () => {
    const { res } = mockResponse();

    await executeParquetQuery(
      { properties: 'admin1', model_release: 'ignored', unknown: 'ignored' },
      '/prevalences',
      parquetPath,
      res,
    );

    expect(db.prepare).toHaveBeenCalledWith(
      `SELECT p.admin1 FROM '${parquetPath}' p `,
    );
    expect(db.bind).toHaveBeenCalledWith({});
  });

  it('rounds floating-point columns but preserves integer columns', async () => {
    const { res } = mockResponse();

    await executeParquetQuery(
      { properties: 'median,no_of_informing_surveys' },
      '/prevalences',
      parquetPath,
      res,
    );

    expect(db.prepare).toHaveBeenCalledWith(
      `SELECT ROUND(p.median, 4) AS median, p.no_of_informing_surveys FROM '${parquetPath}' p `,
    );
  });

  it('rejects a requested property absent from the parquet schema', async () => {
    const { res, response } = mockResponse();

    const result = await executeParquetQuery(
      { properties: 'admin2' },
      '/prevalences',
      parquetPath,
      res,
    );

    expect(result).toBeNull();
    expect(response.send).toHaveBeenCalledWith({ error: 'Invalid property requested: admin2' });
    expect(db.prepare).not.toHaveBeenCalled();
  });
});
