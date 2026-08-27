import { DuckDBInstance } from '@duckdb/node-api';
import { describe, expect, it } from 'vitest';

const modelDir = 'tests/fixtures/data/model/2026.05.08';

const values = async (
  connection: Awaited<ReturnType<DuckDBInstance['connect']>>,
  path: string,
  expression: string,
) => {
  const result = await connection.runAndReadAll(
    `SELECT DISTINCT ${expression} AS value FROM '${path}' ORDER BY value`,
  );
  return result.getRowObjects().map(row => String(row.value));
};

describe('prevalence fixture consistency', () => {
  it('preserves countries, variants, and dates through every admin level', async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    const paths = ['admin0', 'admin1', 'admin2']
      .map(level => `${modelDir}/${level}.parquet`);

    const dimensions = await Promise.all(paths.map(async path => ({
      countries: await values(connection, path, 'admin0'),
      variants: await values(connection, path, 'variant'),
      dates: await values(connection, path, `STRFTIME(date, '%Y-%m-%d')`),
    })));

    expect(dimensions).toEqual([
      dimensions[0],
      dimensions[0],
      dimensions[0],
    ]);
    expect(dimensions[0]).toEqual({
      countries: ['ETH', 'MLI'],
      variants: ['crt:76:K', 'k13:469:Y'],
      dates: ['2003-05-01', '2023-05-01', '2024-05-01', '2025-05-01'],
    });

    const admin1Regions = await values(connection, paths[1], 'admin1');
    const admin2Parents = await values(connection, paths[2], 'admin1');
    expect(admin2Parents).toEqual(admin1Regions);

    const counts = await Promise.all(paths.map(async path => {
      const result = await connection.runAndReadAll(`SELECT COUNT(*) AS count FROM '${path}'`);
      return Number(result.getRowObjects()[0].count);
    }));
    expect(counts).toEqual([16, 32, 64]);

    connection.closeSync();
  });
});
