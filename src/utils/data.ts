import type { Query } from 'express-serve-static-core';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connection } from '../queryEngine.ts';
import config from '../config.ts';
import type { Column } from '../types.ts';
import { validateRequestedProperties } from './validators.ts';
import type { DuckDBResultReader } from '@duckdb/node-api';
import { SURVEY_COLUMNS } from '../constants.ts';
import { endpointConfigs, type Endpoint, type EndpointConfig } from './endpoints.ts';
import { getQueryParamArr, getQueryParamStr } from './query.ts';
import { AppError } from '../middlewares/errorHandler.ts';

export interface Bounds {
  min: { lat: number; lng: number };
  max: { lat: number; lng: number };
}

interface Admin0RegionMetadata {
  id: string;
  bounds: Bounds;
}

export const admin0RegionMetadata = JSON.parse(
  await readFile(join(config.dataDir, "admin0-region-metadata.json"), "utf8"),
) as Admin0RegionMetadata[];

// Arbitrary alias for the parquet file in the SQL queries.
const tableName = "p";

// Build and run an SQL query out of the requested properties and filters.
export const executeParquetQuery = async (
  queryParams: Query,
  path: Endpoint,
  parquetPath: string,
): Promise<DuckDBResultReader> => {
  const config = endpointConfigs[path];

  const parquetColumns = await inspectColumns(parquetPath);
  const properties = getQueryParamArr(queryParams, "properties")
    ?.map(p => p as Column)
    .filter(p => !!p) ?? [];

  validateRequestedProperties(properties, config.requestableProperties, parquetColumns);

  const selectColumns = properties.map(p => `${tableName}.${p}`).join(", ");
  const where = buildWhereClause(queryParams, config);

  const { whereClause, bindings } = where;
  const sql = `SELECT ${selectColumns} FROM '${parquetPath}' ${tableName} ${whereClause}`;
  const statement = await connection.prepare(sql);

  statement.bind(bindings);
  const result = await statement.runAndReadAll();
  return result;
};


// Ask the parquet file for its columns and their SQL types.
const inspectColumns = async (parquetPath: string): Promise<Record<Column, string>> => {
  const parquetColumns = await connection.runAndReadAll(`SELECT * FROM '${parquetPath}' LIMIT 1`);
  const columnTypes = parquetColumns.columnTypes();
  return Object.fromEntries(parquetColumns.columnNames().map((col, index) => {
    return [col, String(columnTypes[index])];
  })) as Record<Column, string>;
};

const buildWhereClause = (queryParams: Query, config: EndpointConfig): {
  whereClause: string
  bindings: Record<string, string | null>
} => {
  const whereClauses = [];
  const bindings: Record<string, string | null> = {}; // Map from param name to value for use in prepared statement.
  const paramsToFilter = config.filterableParams.filter(param => !!queryParams[param]);

  for (const paramName of paramsToFilter) {
    if (paramName === "bbox") {
      const boundsClause = buildBoundsClause(queryParams);
      whereClauses.push(boundsClause);
      continue;
    }
    const column = ["date_from", "date_to"].includes(paramName) ? config.dateColumn : paramName;
    const comparison = paramName === "date_from" ? ">=" : paramName === "date_to" ? "<=" : "=";

    const paramVal = getQueryParamStr(queryParams, paramName) as string;
    whereClauses.push(`${tableName}.${column} ${comparison} $${paramName}`);
    bindings[paramName] = paramVal;
  }

  const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  return { whereClause, bindings };
};

const buildBoundsClause = (queryParams: Query) => {
  const bounds = getQueryParamArr(queryParams, "bbox") as string[];
  const coords = bounds.map(parseFloat);
  const [minLng, minLat, maxLng, maxLat] = coords;
  if (coords.length !== 4 || coords.some(isNaN) || minLat > maxLat) {
    throw new AppError(`Invalid bbox: ${bounds.join(", ")}. Expected format: min_lng,min_lat,max_lng,max_lat`, 400);
  }
  if (minLng > maxLng) {
    throw new AppError("Bounding box should not cross antimeridian. Expected format: min_lng,min_lat,max_lng,max_lat", 400);
  }

  return [
    `${tableName}.${SURVEY_COLUMNS.LAT} >= ${minLat}`,
    `${tableName}.${SURVEY_COLUMNS.LAT} <= ${maxLat}`,
    `${tableName}.${SURVEY_COLUMNS.LNG} >= ${minLng}`,
    `${tableName}.${SURVEY_COLUMNS.LNG} <= ${maxLng}`
  ].join(" AND ");
};

export const prevalencesParquet = (modelVersion: string, adminLevel: string) =>
  join(config.dataDir, "model", modelVersion, `admin${adminLevel}.parquet`);

export const surveyDataParquet = (dataVersion: string) =>
  join(config.dataDir, "stave", dataVersion, "survey_data.parquet");
