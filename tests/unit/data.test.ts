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
  date: 'VARCHAR',
  collection_day: 'DATE',
  median: 'DOUBLE',
  no_of_informing_surveys: 'INTEGER',
  survey_id: 'VARCHAR',
  lat: 'DOUBLE',
  lng: 'DOUBLE',
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
    await executeParquetQuery(
      {
        properties: 'admin1,median',
        gene: 'crt',
        mutation: '76K',
        date: '2024-05',
      },
      '/prevalences',
      admin1ParquetPath,
    );

    expect(db.prepare).toHaveBeenCalledWith(
      `SELECT p.admin1, p.median FROM '${admin1ParquetPath}' p ` +
      'WHERE p.gene = $gene AND p.mutation = $mutation AND p.date = $date',
    );
    expect(db.bind).toHaveBeenCalledWith({
      gene: 'crt',
      mutation: '76K',
      date: '2024-05',
    });
  });

  it('maps date ranges to the `date` column for the prevalences endpoint, using inequality operators', async () => {
    await executeParquetQuery(
      {
        properties: 'admin1',
        date_from: '2023-05',
        date_to: '2025-05',
      },
      '/prevalences',
      admin1ParquetPath,
    );

    expect(db.prepare).toHaveBeenCalledWith(
      `SELECT p.admin1 FROM '${admin1ParquetPath}' p ` +
      'WHERE p.date >= $date_from AND p.date <= $date_to',
    );
    expect(db.bind).toHaveBeenCalledWith({
      date_from: '2023-05',
      date_to: '2025-05',
    });
  });

  it('maps date ranges to the `collection_day` column for the surveys endpoint, using inequality operators', async () => {
    await executeParquetQuery(
      {
        properties: 'gene',
        date_from: '2023-05-01',
        date_to: '2025-05-01',
      },
      '/surveys',
      admin1ParquetPath,
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
    await executeParquetQuery(
      { properties: 'admin1', admin0: 'MLI' },
      '/prevalences',
      admin1ParquetPath,
    );

    expect(db.prepare).toHaveBeenCalledWith(
      `SELECT p.admin1 FROM '${admin1ParquetPath}' p WHERE p.admin0 = $admin0`,
    );
    expect(db.bind).toHaveBeenCalledWith({ admin0: 'MLI' });
  });

  it('filters survey data using latitude and longitude bounds', async () => {
    await executeParquetQuery(
      { properties: 'survey_id', bbox: ['-12.2389','10.1595','0','25'], date_from: '2010-01-01', date_to: '2010-02-01' },
      '/surveys',
      surveyPath,
    );

    expect(db.prepare).toHaveBeenCalledWith(
      `SELECT p.survey_id FROM '${surveyPath}' p WHERE ` +
      'p.lat >= 10.1595 AND p.lat <= 25 AND p.lng >= -12.2389 AND p.lng <= 0 ' +
      'AND p.collection_day >= $date_from AND p.collection_day <= $date_to',
    );
    expect(db.bind).toHaveBeenCalledWith({
      date_from: '2010-01-01',
      date_to: '2010-02-01',
    });
  });

  it('sends a 400 after getting a partial bounding box', async () => {
    await expect(
      executeParquetQuery(
        { properties: 'survey_id', bbox: ['1','2'] },
        '/surveys',
        surveyPath,
      ),
    ).rejects.toThrow('Invalid bbox: 1, 2');
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('sends a 400 after getting an invalid bounding box', async () => {
    await expect(
      executeParquetQuery(
        { properties: 'survey_id', bbox: ['1','4','3','2'] },
        '/surveys',
        surveyPath,
      ),
    ).rejects.toThrow('Invalid bbox: 1, 4, 3, 2');
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('sends a 400 after getting a bounding box that crosses the antimeridian', async () => {
    await expect(
      executeParquetQuery(
        { properties: 'survey_id', bbox: '170,10,-170,20' },
        '/surveys',
        surveyPath,
      ),
    ).rejects.toThrow('Bounding box should not cross antimeridian');
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('omits WHERE when no filterable parameters are provided', async () => {
    await executeParquetQuery(
      { properties: 'admin1' },
      '/prevalences',
      admin1ParquetPath,
    );

    expect(db.prepare).toHaveBeenCalledWith(
      `SELECT p.admin1 FROM '${admin1ParquetPath}' p `,
    );
    expect(db.bind).toHaveBeenCalledWith({});
  });

  it('rejects a requested property if it belongs to a different parquet schema', async () => {
    await expect(
      executeParquetQuery(
        { properties: 'admin2' },
        '/prevalences',
        admin1ParquetPath,
      ),
    ).rejects.toThrow('Invalid property requested: admin2');
    expect(db.prepare).not.toHaveBeenCalled();
  });
});
