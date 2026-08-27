import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';

const fixtureDataDir = 'tests/fixtures/data';
const modelDir = join(fixtureDataDir, 'model', '2026.05.08');
const staveDir = join(fixtureDataDir, 'stave', '2026.03.17');

const instance = await DuckDBInstance.create(':memory:');
const connection = await instance.connect();

const writeParquet = async (path: string, table: string, createSql: string, insertSql: string) => {
  await mkdir(dirname(path), { recursive: true });
  await rm(path, { force: true });
  await connection.run(`DROP TABLE IF EXISTS ${table}`);
  await connection.run(createSql);
  await connection.run(insertSql);
  await connection.run(`COPY ${table} TO '${path}' (FORMAT PARQUET)`);
};

const prevalenceColumns = `
  variant VARCHAR,
  gene VARCHAR,
  mutation VARCHAR,
  admin0 VARCHAR,
  ADMIN_COLUMNS
  admin_level INTEGER,
  date DATE,
  mean DOUBLE,
  median DOUBLE,
  SD DOUBLE,
  lower_95 DOUBLE,
  upper_95 DOUBLE,
  exceedance_1 DOUBLE,
  exceedance_2 DOUBLE,
  exceedance_5 DOUBLE,
  exceedance_10 DOUBLE,
  no_of_informing_surveys INTEGER,
  nearest_survey_by_date VARCHAR
`;

const variants = [
  { variant: 'crt:76:K', gene: 'crt', mutation: '76K' },
  { variant: 'k13:469:Y', gene: 'k13', mutation: '469Y' },
];

const dates = [
  { date: '2003-05-01', median: 0.2 },
  { date: '2023-05-01', median: 0.4 },
  { date: '2024-05-01', median: 0.56470588235 },
  { date: '2025-05-01', median: 0.7 },
];

const countries = [
  {
    admin0: 'MLI',
    medianOffset: 0,
    admin1Regions: [
      { admin1: 'MLI.1_1', medianOffset: 0, admin2Regions: ['MLI.1.1_1', 'MLI.1.2_1'] },
      { admin1: 'MLI.2_1', medianOffset: 0.02, admin2Regions: ['MLI.2.1_1', 'MLI.2.2_1'] },
    ],
  },
  {
    admin0: 'ETH',
    medianOffset: 0.1,
    admin1Regions: [
      { admin1: 'ETH.1_1', medianOffset: 0, admin2Regions: ['ETH.1.1_1', 'ETH.1.2_1'] },
      { admin1: 'ETH.2_1', medianOffset: 0.02, admin2Regions: ['ETH.2.1_1', 'ETH.2.2_1'] },
    ],
  },
];

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const stats = (median: number, country: string) => [
  median + 0.01,
  median,
  0.02,
  median - 0.1,
  median + 0.1,
  0.9,
  0.8,
  0.7,
  0.6,
  2,
  quote(country === 'MLI' ? 's0001_Bamako' : 's0002_Gondar_Zuria'),
].join(', ');

const admin0Rows: string[] = [];
const admin1Rows: string[] = [];
const admin2Rows: string[] = [];

for (const country of countries) {
  for (const [variantIndex, variant] of variants.entries()) {
    for (const date of dates) {
      const variantOffset = variantIndex * 0.03;
      const countryMedian = date.median + country.medianOffset + variantOffset;
      admin0Rows.push([
        quote(variant.variant),
        quote(variant.gene),
        quote(variant.mutation),
        quote(country.admin0),
        '0',
        `DATE ${quote(date.date)}`,
        stats(countryMedian, country.admin0),
      ].join(', '));

      for (const admin1Region of country.admin1Regions) {
        const admin1Median = countryMedian + admin1Region.medianOffset;
        admin1Rows.push([
          quote(variant.variant),
          quote(variant.gene),
          quote(variant.mutation),
          quote(country.admin0),
          quote(admin1Region.admin1),
          '1',
          `DATE ${quote(date.date)}`,
          stats(admin1Median, country.admin0),
        ].join(', '));

        for (const [admin2Index, admin2] of admin1Region.admin2Regions.entries()) {
          const admin2Median = admin1Median + admin2Index * 0.01;
          admin2Rows.push([
            quote(variant.variant),
            quote(variant.gene),
            quote(variant.mutation),
            quote(country.admin0),
            quote(admin1Region.admin1),
            quote(admin2),
            '2',
            `DATE ${quote(date.date)}`,
            stats(admin2Median, country.admin0),
          ].join(', '));
        }
      }
    }
  }
}

await writeParquet(
  join(modelDir, 'admin0.parquet'),
  'admin0',
  `CREATE TABLE admin0 (${prevalenceColumns.replace('ADMIN_COLUMNS', '')})`,
  `INSERT INTO admin0 VALUES ${admin0Rows.map(row => `(${row})`).join(',\n')}`,
);

await writeParquet(
  join(modelDir, 'admin1.parquet'),
  'admin1',
  `CREATE TABLE admin1 (${prevalenceColumns.replace('ADMIN_COLUMNS', 'admin1 VARCHAR,')})`,
  `INSERT INTO admin1 VALUES ${admin1Rows.map(row => `(${row})`).join(',\n')}`,
);

await writeParquet(
  join(modelDir, 'admin2.parquet'),
  'admin2',
  `CREATE TABLE admin2 (${prevalenceColumns.replace('ADMIN_COLUMNS', 'admin1 VARCHAR, admin2 VARCHAR,')})`,
  `INSERT INTO admin2 VALUES ${admin2Rows.map(row => `(${row})`).join(',\n')}`,
);

await writeParquet(
  join(staveDir, 'survey_data.parquet'),
  'surveys',
  `CREATE TABLE surveys (
    study_id VARCHAR,
    study_label VARCHAR,
    contributors VARCHAR,
    reference VARCHAR,
    reference_year DOUBLE,
    survey_id VARCHAR,
    site_name VARCHAR,
    lat DOUBLE,
    lng DOUBLE,
    collection_start DATE,
    collection_end DATE,
    collection_day DATE,
    numerator DOUBLE,
    denominator DOUBLE,
    prevalence DOUBLE,
    prevalence_lower DOUBLE,
    prevalence_upper DOUBLE,
    variant VARCHAR,
    gene VARCHAR,
    mutation VARCHAR
  )`,
  `INSERT INTO surveys VALUES
    ('study-1', 'Bamako study', 'A. Author', 'doi:1', 2011, 's0001_Bamako', 'Bamako', 12.6129, -8.1356, DATE '2010-01-01', DATE '2010-01-31', DATE '2010-01-15', 130, 170, 76.47059, 69.36751, 82.62694, 'crt:76:K', 'crt', '76K'),
    ('study-2', 'Gondar Zuria study', 'B. Author', 'doi:2', 2017, 's0002_Gondar_Zuria', 'Gondar Zuria', 12.6, 37.5, DATE '2010-01-01', DATE '2010-01-31', DATE '2010-01-20', 40, 100, 40, 30, 50, 'crt:76:K', 'crt', '76K'),
    ('study-3', 'Historic Mali study', 'C. Author', 'doi:3', 2002, 's0003_Historic_Mali', 'Kayes', 14.45, -11.43, DATE '2001-05-01', DATE '2001-05-31', DATE '2001-05-15', 10, 100, 10, 5, 15, 'crt:76:K', 'crt', '76K'),
    ('study-4', 'Future Ethiopia study', 'D. Author', 'doi:4', 2029, 's0004_Future_ETH', 'Addis Ababa', 9.03, 38.74, DATE '2029-05-01', DATE '2029-05-31', DATE '2029-05-15', 20, 100, 20, 12, 28, 'crt:76:K', 'crt', '76K'),
    ('study-5', 'Other mutation study', 'E. Author', 'doi:5', 2011, 's0005_Other_Mutation', 'Bamako', 12.62, -8.14, DATE '2010-01-01', DATE '2010-01-31', DATE '2010-01-16', 5, 100, 5, 2, 10, 'k13:469:Y', 'k13', '469Y')`,
);

await connection.closeSync();
