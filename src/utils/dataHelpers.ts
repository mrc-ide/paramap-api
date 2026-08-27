import { type Response } from 'express';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connection } from '../queryEngine.ts';
import config from '../config/config.ts';
import type { QueryParams } from '../types.ts';
import { validateRequestedProperties } from './validators.ts';
import type { DuckDBResultReader } from '@duckdb/node-api';

type Bindings = Record<string, string | null>;
type ColumnTypes = Record<string, string>;
interface Admin0RegionMetadata {
  id: string;
  bounds: {
    min: { lat: number; lng: number };
    max: { lat: number; lng: number };
  };
}

const admin0RegionMetadata = JSON.parse(
  await readFile(join(config.dataDir, "admin0-region-metadata.json"), "utf8"),
) as Admin0RegionMetadata[];

// Arbitrary alias for the parquet file in the SQL queries.
const tableName = "p";

const roundableColumnTypes = ["DOUBLE", "FLOAT", "DECIMAL"];

// column mode: filter on the admin0 column directly.
// bounds mode: translate the admin0 ISO code into lat/lng bounding-boxes.
// Survey data does not come with region metadata, so we filter it by lat/lng.
const Admin0Mode = {
  BOUNDS: "bounds",
  COLUMN: "column",
} as const;

type Admin0Mode = typeof Admin0Mode[keyof typeof Admin0Mode];

type Endpoint = "/surveys" | "/prevalences";
interface EndpointConfig {
  // An allow-list of properties that clients may request as columns.
  requestableProperties: string[];
  // Query parameters that may be used to filter the rows.
  filterableParams: string[];
  // The column to filter on for requests that scope by date_from/date_to.
  dateColumn: string;
  admin0Mode: Admin0Mode;
}

const endpointConfigs: Record<Endpoint, EndpointConfig> = {
  "/surveys": {
    requestableProperties: [
      "study_label",
      "contributors",
      "reference",
      "reference_year",
      "survey_id",
      "site_name",
      "lat",
      "lng",
      "collection_start",
      "collection_end",
      "collection_day",
      "numerator",
      "denominator",
      "prevalence",
      "prevalence_lower",
      "prevalence_upper",
      "variant",
      "gene",
      "mutation",
    ],
    filterableParams: ["admin0", "survey_id", "date_from", "date_to", "gene", "mutation"],
    dateColumn: "collection_day",
    admin0Mode: "bounds",
  },
  "/prevalences": {
    requestableProperties: [
      "variant",
      "gene",
      "mutation",
      "admin0",
      "admin1",
      "admin2",
      "date",
      "mean",
      "median",
      "SD",
      "lower_95",
      "upper_95",
      "exceedance_1",
      "exceedance_2",
      "exceedance_5",
      "exceedance_10",
      "no_of_informing_surveys",
      "nearest_survey_by_date" // gives a survey_id
    ],
    filterableParams: ["admin0", "admin1", "admin2", "gene", "mutation", "date", "date_from", "date_to"],
    dateColumn: "date",
    admin0Mode: "column",
  },
} as const;

// Build and run an SQL query out of the requested properties and filters.
export const executeParquetQuery = async (
  queryParams: QueryParams,
  path: Endpoint,
  parquetPath: string,
  res: Response,
): Promise<DuckDBResultReader | null> => {
  const config = endpointConfigs[path];

  const parquetColumns = await inspectColumns(parquetPath);
  const properties = validateRequestedProperties(queryParams, config.requestableProperties, parquetColumns, res);
  if (!properties) {
    return null;
  }

  const selectColumns = await buildSelectColumns(parquetPath, properties);
  const where = buildWhereClause(queryParams, config, res);
  if (!where) {
    return null;
  }
  const { whereClause, bindings } = where;
  const sql = `SELECT ${selectColumns} FROM '${parquetPath}' ${tableName} ${whereClause}`;
  const statement = await connection.prepare(sql);
  statement.bind(bindings);
  const result = await statement.runAndReadAll();
  return result;
};

const buildSelectColumns = async (
  parquetPath: string,
  requestedProperties: string[],
): Promise<string> => {
  const parquetColumns = await inspectColumns(parquetPath);

  return requestedProperties.map((p) => {
    // Round to 4 decimal places for numeric columns, to reduce size of response
    const columnType = parquetColumns[p];
    return roundableColumnTypes.includes(columnType)
      ? `ROUND(${tableName}.${p}, 4) AS ${p}`
      : `${tableName}.${p}`;
  }).join(", ");
};


// Ask the parquet file for its columns and their SQL types.
const inspectColumns = async (parquetPath: string): Promise<ColumnTypes> => {
  const parquetColumns = await connection.runAndReadAll(`SELECT * FROM '${parquetPath}' LIMIT 1`);
  const columnTypes = parquetColumns.columnTypes();
  return Object.fromEntries(parquetColumns.columnNames().map((col, index) => {
    return [col, String(columnTypes[index])];
  }));
};

const buildWhereClause = (queryParams: QueryParams, config: EndpointConfig, res: Response): {
  whereClause: string
  bindings: Bindings
} | null => {
  const whereClauses = [];
  const bindings: Bindings = {}; // Map from param name to value for use in prepared statement.
  const columnsToFilter = config.filterableParams.filter(param => !!queryParams[param]);

  for (const param of columnsToFilter) {
    if (param === "admin0" && config.admin0Mode === "bounds") {
      const boundsClause = buildWhereBoundsClause(queryParams.admin0!, res);
      if (!boundsClause) {
        return null;
      }
      whereClauses.push(boundsClause);
      continue;
    }
    const column = ["date_from", "date_to"].includes(param) ? config.dateColumn : param;
    const equality = param === "date_from" ? ">=" : param === "date_to" ? "<=" : "=";

    whereClauses.push(`${tableName}.${column} ${equality} $${param}`);
    bindings[param] = queryParams[param] ?? null;
  }

  const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  return { whereClause, bindings };
};

const buildWhereBoundsClause = (iso: string, res: Response) => {
  const region = admin0RegionMetadata.find(({ id }) => id === iso);
  if (!region) {
    res.status(400).send({ error: `ISO code not found: ${iso}` });
    return null;
  }
  const bounds = region.bounds;

  return [
    `${tableName}.lat >= ${bounds.min.lat}`,
    `${tableName}.lat <= ${bounds.max.lat}`,
    `${tableName}.lng >= ${bounds.min.lng}`,
    `${tableName}.lng <= ${bounds.max.lng}`
  ].join(" AND ");
};
