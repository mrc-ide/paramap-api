import { type Response } from 'express';
import { connection } from '../queryEngine.ts';
import admin0RegionMetadata from '../../data/admin0-region-metadata.json' with { type: "json" };
import type { QueryParams } from '../types.ts';
import { validateRequestedProperties } from './validators.ts';

type Bindings = Record<string, string | null>;

// Arbitrary alias for the parquet file in the SQL queries.
const tableName = "p";

interface EndpointConfig {
  // Allow-list of properties that clients may request as columns.
  requestableProperties: string[];
  // Query parameters that may be used to filter the rows.
  selectableParamNames: string[];
  // The column that date_from/date_to filter on.
  dateColumn: string;
  // 'bounds': translate the admin0 ISO code into lat/lng bounding-box clauses (no admin0 column in the data).
  // 'column': filter on the admin0 column directly.
  admin0Mode: 'bounds' | 'column';
}

const endpointConfigs: Record<string, EndpointConfig> = {
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
};

// Probe the parquet file for its columns, and identify the numeric columns whose values can be rounded.
const introspectColumns = async (parquetPath: string): Promise<{
  availableColumns: string[];
  roundableColumns: string[];
}> => {
  const columnsInData = await connection.runAndReadAll(`SELECT * FROM '${parquetPath}' LIMIT 1`);
  const availableColumns = columnsInData.columnNames(); // Conceivably will vary by release if schema changes
  const columnTypes = columnsInData.columnTypes();
  const roundableColumns = availableColumns.filter((_col, index) => {
    return ["DOUBLE", "FLOAT", "DECIMAL"].includes(String(columnTypes[index]));
  });
  return { availableColumns, roundableColumns };
};

// Sends a 400 response and returns false if any requested property is not requestable or not present in the data.
const validateProperties = (
  properties: string[],
  requestableProperties: string[],
  availableColumns: string[],
  res: Response,
): boolean => {
  const invalid = properties.find(p => !requestableProperties.includes(p) || !availableColumns.includes(p));
  if (invalid) {
    res.status(400).send({ error: `Invalid property requested: ${invalid}` });
    return false;
  }
  return true;
};

const buildWhereClauses = ({ selectableParams, queryParams, dateColumn, admin0Mode }: {
  selectableParams: string[];
  queryParams: QueryParams;
  // The column that date_from/date_to filter on.
  dateColumn: string;
  // 'bounds': translate the admin0 ISO code into lat/lng bounding-box clauses (no admin0 column in the data).
  // 'column': filter on the admin0 column directly.
  admin0Mode: 'bounds' | 'column';
}): { whereClauses: string[]; bindings: Bindings } | { error: string } => {
  const whereClauses = ["1 = 1"]; // Start with a dummy condition to simplify appending AND clauses
  const bindings: Bindings = {};

  for (const param of selectableParams) {
    if (param === "admin0" && admin0Mode === "bounds") {
      const iso = queryParams[param]!;
      const region = admin0RegionMetadata.find(({ id }) => id === iso);
      if (!region) {
        return { error: `ISO code not found: ${iso}` };
      }
      const bounds = region.bounds;

      // We use lat and lng instead of admin0 in the SQL query, so admin0 is not added to the bindings.
      whereClauses.push(
        `${tableName}.lat >= ${bounds.min.lat}`,
        `${tableName}.lat <= ${bounds.max.lat}`,
        `${tableName}.lng >= ${bounds.min.lng}`,
        `${tableName}.lng <= ${bounds.max.lng}`
      );
      continue;
    }
    const column = ["date_from", "date_to"].includes(param) ? dateColumn : param;
    const equality = param === "date_from" ? ">=" : param === "date_to" ? "<=" : "=";

    whereClauses.push(`${tableName}.${column} ${equality} $${param}`);
    bindings[param] = queryParams[param] ?? null;
  }

  return { whereClauses, bindings };
};

const buildSelectColumns = (
  properties: string[],
  roundableColumns: string[],
): string =>
  properties.map((p) => {
    if (roundableColumns.includes(p)) {
      // Round to 4 decimal places for numeric columns, to reduce size of response
      return `ROUND(${tableName}.${p}, 4) AS ${p}`;
    }
    return `${tableName}.${p}`;
  }).join(", ");

const runQuery = async (
  parquetPath: string,
  selectColumns: string,
  whereClauses: string[],
  bindings: Bindings,
) => {
  const statement = await connection.prepare(
    `SELECT ${selectColumns} FROM '${parquetPath}' ${tableName} WHERE ${whereClauses.join(' AND ')}`
  );
  statement.bind(bindings);
  return statement.runAndReadAll();
};

// Run the whole query pipeline for an endpoint: parse and validate the requested properties,
// build the WHERE clauses from the endpoint's filterable query parameters, and execute the query.
// Endpoint-specific configuration is looked up from the supplied request path.
// Sends a 400 response and returns null on any validation failure.
export const executeParquetQuery = async (
  queryParams: QueryParams,
  path: string,
  parquetPath: string,
  res: Response,
) => {
  const config = endpointConfigs[path];
  if (!config) {
    throw new Error(`No endpoint config found for path: ${path}`);
  }

  const properties = validateRequestedProperties(queryParams, res);
  if (!properties) {
    return null;
  }

  const { availableColumns, roundableColumns } = await introspectColumns(parquetPath);

  if (!validateProperties(properties, config.requestableProperties, availableColumns, res)) {
    return null;
  }

  const selectableParams = config.selectableParamNames.filter(param => !!queryParams[param]);
  const whereResult = buildWhereClauses({
    selectableParams,
    queryParams,
    dateColumn: config.dateColumn,
    admin0Mode: config.admin0Mode,
  });
  if ("error" in whereResult) {
    res.status(400).send({ error: whereResult.error });
    return null;
  }
  const { whereClauses, bindings } = whereResult;

  const selectColumns = buildSelectColumns(properties, roundableColumns);
  return runQuery(parquetPath, selectColumns, whereClauses, bindings);
};
