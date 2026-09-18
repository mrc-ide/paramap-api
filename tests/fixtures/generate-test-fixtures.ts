// Generates the committed test fixtures by slicing the real datasets.
import { access, cp, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import fixtureConfig from './fixture-config.json' with { type: 'json' };

const sourceDir = 'data';
const fixtureDir = 'tests/fixtures/data';
const sourceModelDir = join(sourceDir, 'model', fixtureConfig.modelRelease);

const prevalencePaths = [0, 1, 2].map(level => `model/${fixtureConfig.modelRelease}/admin${level}.parquet`);
const metadata = JSON.parse(await readFile(join(sourceModelDir, 'metadata.json'), 'utf8'));
const surveyPath = `stave/${metadata.data_release}/survey_data.parquet`;

// Validate that the source data exists before attempting to generate fixtures from them.
const requiredPaths = [
  ...prevalencePaths.map(path => join(sourceDir, path)),
  join(sourceModelDir, 'metadata.json'),
  join(sourceDir, 'admin0-region-metadata.json'),
  join(sourceDir, surveyPath)
];
const missing: string[] = [];
for (const path of requiredPaths) {
  await access(path).catch(() => missing.push(path));
}
if (missing.length > 0) {
  throw new Error(
    `Cannot generate test fixtures; missing source data:\n${missing.map(p => `  - ${p}`).join('\n')}`
  );
}

const connection = await (await DuckDBInstance.create(':memory:')).connect();

await rm(fixtureDir, { recursive: true, force: true });
for (const path of prevalencePaths) {
  const prevalenceDestination = join(fixtureDir, path);
  await mkdir(dirname(prevalenceDestination), { recursive: true });
  await connection.run(`
    COPY (
      SELECT * FROM '${(join(sourceDir, path))}'
      WHERE
        admin0 IN (${fixtureConfig.countries.map(c => `'${c}'`).join(', ')})
        AND (${fixtureConfig.variantWindows.map(w =>
          `(variant = '${w.variant}' AND date BETWEEN DATE '${w.start}' AND DATE '${w.end}')`,
        ).join(' OR ')})
    )
    TO '${prevalenceDestination}' (FORMAT PARQUET)
  `);
}

const surveyDestination = join(fixtureDir, surveyPath);
await mkdir(dirname(surveyDestination), { recursive: true });
await connection.run(`
  COPY (
    SELECT * FROM '${(join(sourceDir, surveyPath))}'
    WHERE
      survey_id IN (${fixtureConfig.surveyIds.map(c => `'${c}'`).join(', ')})
      AND variant IN (${fixtureConfig.variantWindows.map(w => `'${w.variant}'`).join(', ')})
  )
  TO '${surveyDestination}' (FORMAT PARQUET)
`);

await cp(join(sourceModelDir, 'metadata.json'), join(fixtureDir, 'model', fixtureConfig.modelRelease, 'metadata.json'));
await cp(join(sourceDir, 'admin0-region-metadata.json'), join(fixtureDir, 'admin0-region-metadata.json'));

connection.closeSync();
