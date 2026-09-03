import { type Response } from 'express';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connection } from '../queryEngine.ts';
import config from '../config/config.ts';
import type { Column, QueryParams } from '../types.ts';
import { validateRequestedProperties } from './validators.ts';
import type { DuckDBResultReader } from '@duckdb/node-api';
import { SURVEY_COLUMNS } from '../constants.ts';
import { endpointConfigs, type Endpoint, type EndpointConfig } from './endpoints.ts';

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

// Build and run an SQL query out of the requested properties and filters.
export const executeParquetQuery = async (
  queryParams: QueryParams,
  path: Endpoint,
  parquetPath: string,
  res: Response,
): Promise<DuckDBResultReader | undefined> => {
  const config = endpointConfigs[path];

  const parquetColumns = await inspectColumns(parquetPath);
  if (!validateRequestedProperties(queryParams, config.requestableProperties, parquetColumns, res)) return;

  const properties = queryParams.properties?.split(',').map(p => p as Column) ?? [];
  const selectColumns = await buildSelectColumns(parquetPath, properties);
  const where = buildWhereClause(queryParams, config, res);
  if (!where) return;

  const { whereClause, bindings } = where;
  const sql = `SELECT ${selectColumns} FROM '${parquetPath}' ${tableName} ${whereClause}`;
  const statement = await connection.prepare(sql);

  console.log(sql);

  statement.bind(bindings);
  const result = await statement.runAndReadAll();
  return result;
};

// Make parquet files read-only?

const buildSelectColumns = async (
  parquetPath: string,
  requestedProperties: Column[],
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
const inspectColumns = async (parquetPath: string): Promise<Record<Column, string>> => {
  const parquetColumns = await connection.runAndReadAll(`SELECT * FROM '${parquetPath}' LIMIT 1`);
  const columnTypes = parquetColumns.columnTypes();
  return Object.fromEntries(parquetColumns.columnNames().map((col, index) => {
    return [col, String(columnTypes[index])];
  })) as Record<Column, string>;
};

const buildWhereClause = (queryParams: QueryParams, config: EndpointConfig, res: Response): {
  whereClause: string
  bindings: Record<string, string | null>
} | undefined => {
  const whereClauses = [];
  const bindings: Record<string, string | null> = {}; // Map from param name to value for use in prepared statement.
  const paramsToFilter = config.filterableParams.filter(param => !!queryParams[param]);

  for (const paramName of paramsToFilter) {
    if (paramName === "admin0" && config.admin0Mode === "bounds") {
      const region = admin0RegionMetadata.find(({ id }) => id === queryParams.admin0);
      if (!region) {
        res.status(400).send({ error: `ISO code not found: ${queryParams.admin0}` });
        return;
      }
      whereClauses.push(buildBoundsClause(region));
      continue;
    }
    const column = ["date_from", "date_to"].includes(paramName) ? config.dateColumn : paramName;
    const equality = paramName === "date_from" ? ">=" : paramName === "date_to" ? "<=" : "=";

    const paramVal = queryParams[paramName];
    whereClauses.push(`${tableName}.${column} ${equality} $${paramName}`);
    bindings[paramName] = paramVal ?? null;
  }

  const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  return { whereClause, bindings };
};

const buildBoundsClause = (region: Admin0RegionMetadata) => {
  const bounds = region.bounds;

  return [
    `${tableName}.${SURVEY_COLUMNS.LAT} >= ${bounds.min.lat}`,
    `${tableName}.${SURVEY_COLUMNS.LAT} <= ${bounds.max.lat}`,
    `${tableName}.${SURVEY_COLUMNS.LNG} >= ${bounds.min.lng}`,
    `${tableName}.${SURVEY_COLUMNS.LNG} <= ${bounds.max.lng}`
  ].join(" AND ");
};
