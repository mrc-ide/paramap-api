import { readFile } from 'node:fs/promises';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { describe, expect, it } from 'vitest';
import fixtureConfig from '../fixtures/fixture-config.json' with { type: 'json' };

const modelDir = `tests/fixtures/data/model/${fixtureConfig.modelRelease}`;

const values = async (
  connection: DuckDBConnection,
  path: string,
  expression: string,
) => {
  const result = await connection.runAndReadAll(
    `SELECT DISTINCT ${expression} AS value FROM '${path}' ORDER BY value`,
  );
  return result.getRowObjects().map(row => String(row.value));
};

const dimensionTuples = async (connection: DuckDBConnection, path: string) => {
  const result = await connection.runAndReadAll(`
    SELECT DISTINCT admin0, variant, STRFTIME(date, '%Y-%m-%d') AS date
    FROM '${path}'
    ORDER BY admin0, variant, date
  `);
  return result.getRowObjects().map(row => `${row.admin0}|${row.variant}|${row.date}`);
};

const monthlyDates = (start: string, end: string) => {
  const result = [];
  const current = new Date(`${start}T00:00:00Z`);
  const final = new Date(`${end}T00:00:00Z`);
  while (current <= final) {
    result.push(current.toISOString().slice(0, 10));
    current.setUTCMonth(current.getUTCMonth() + 1);
  }
  return result;
};

const expectCompleteDateWindows = async (
  connection: DuckDBConnection,
  path: string,
  adminLevel: number,
) => {
  const regionColumns = [
    'admin0',
    ...(adminLevel >= 1 ? ['admin1'] : []),
    ...(adminLevel >= 2 ? ['admin2'] : []),
  ];
  const result = await connection.runAndReadAll(`
    SELECT ${regionColumns.join(', ')}, variant, STRFTIME(date, '%Y-%m-%d') AS date
    FROM '${path}'
  `);
  const rows = result.getRowObjects();
  const regions = new Set(rows.map(row =>
    regionColumns.map(column => String(row[column])).join('/'),
  ));

  for (const region of regions) {
    for (const window of fixtureConfig.variantWindows) {
      const dates = rows
        .filter(row =>
          regionColumns.map(column => String(row[column])).join('/') === region &&
          row.variant === window.variant,
        )
        .map(row => String(row.date))
        .sort();
      expect(dates, `${region} ${window.variant} at admin${adminLevel}`)
        .toEqual(monthlyDates(window.start, window.end));
    }
  }
};

describe('prevalence fixture validity', () => {
  it('preserves dimensions and complete variant date windows at every admin level', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    const paths = [0, 1, 2].map(level => `${modelDir}/admin${level}.parquet`);

    const tuples = await Promise.all(paths.map(path => dimensionTuples(connection, path)));
    expect(tuples[1]).toEqual(tuples[0]);
    expect(tuples[2]).toEqual(tuples[0]);

    expect(await values(connection, paths[0], 'admin0'))
      .toEqual([...fixtureConfig.countries].sort());
    expect(await values(connection, paths[0], 'variant'))
      .toEqual(fixtureConfig.variantWindows.map(window => window.variant).sort());

    for (const [adminLevel, path] of paths.entries()) {
      await expectCompleteDateWindows(connection, path, adminLevel);
    }

    connection.closeSync();
  });
});

describe('survey fixture validity', () => {
  it('contains the required surveys, both inside and outside MLI bounds', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    const path = `tests/fixtures/data/stave/${fixtureConfig.dataRelease}/survey_data.parquet`;

    expect(await values(connection, path, 'survey_id'))
      .toEqual([...fixtureConfig.surveyIds].sort());

    const regions = JSON.parse(await readFile('tests/fixtures/data/admin0-region-metadata.json', 'utf8'));
    const { min, max } = regions.find(({ id }: { id: string }) => id === 'MLI').bounds;
    const inMali = `lat BETWEEN ${min.lat} AND ${max.lat} AND lng BETWEEN ${min.lng} AND ${max.lng}`;
    const counts = await connection.runAndReadAll(`
      SELECT COUNT(*) FILTER (WHERE ${inMali}) AS inside,
             COUNT(*) FILTER (WHERE NOT (${inMali})) AS outside
      FROM '${path}'
    `);
    const { inside, outside } = counts.getRowObjects()[0];
    expect(Number(inside)).toBeGreaterThan(0);
    expect(Number(outside)).toBeGreaterThan(0);

    connection.closeSync();
  });
});
