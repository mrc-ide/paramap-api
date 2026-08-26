import { type Response } from 'express';
import { connection } from '../queryEngine.ts';
import admin0RegionMetadata from '../../data/admin0-region-metadata.json' with { type: "json" };
import type { QueryParams } from '../types.ts';
import { validateRequestedProperties } from './validators.ts';
import type { DuckDBResultReader } from '@duckdb/node-api';

type Bindings = Record<string, string | null>;
type ColumnTypes = Record<string, string>;

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
  selectableParamNames: string[];
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
    selectableParamNames: ["admin0", "survey_id", "date_from", "date_to", "gene", "mutation"],
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
    selectableParamNames: ["admin0", "admin1", "admin2", "gene", "mutation", "date", "date_from", "date_to"],
    dateColumn: "date",
    admin0Mode: "column",
  },
} as const;

// Run the whole query pipeline for an endpoint: parse and validate the requested properties,
// build the WHERE clauses from the endpoint's filterable query parameters, and execute the query.
// Sends a 400 response and returns null on any validation failure
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
  const { whereClause, bindings } = buildWhereClause(queryParams, config, res);
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


// Probe the parquet file for its columns and their SQL types.
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
} => {
  const whereClauses = [];
  const bindings: Bindings = {}; // SQL variable bindings
  const columnsToSelect = config.selectableParamNames.filter(param => !!queryParams[param]);

  for (const param of columnsToSelect) {
    if (param === "admin0" && config.admin0Mode === "bounds") {
      whereClauses.push(buildWhereBoundsClause(queryParams.admin0!, res));
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
