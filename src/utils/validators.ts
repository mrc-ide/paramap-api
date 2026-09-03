import { type Request, type Response } from 'express';
import { modelVersions, dataVersions, adminLevels } from '../constants.ts';
import type { QueryParams, Column } from '../types.ts';
import { endpointConfigs, type Endpoint } from './data.ts';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const validateRequiredQueryParams = (
  req: Request,
  res: Response,
): boolean => {
  const path = req.path as Endpoint;
  const missingParams = endpointConfigs[path].requiredParams.filter(param => !req.query[param]);
  if (missingParams.length > 0) {
    res.status(400).send({ error: `Missing required query parameters: ${missingParams.join(', ')}` });
    return false;
  }
  return true;
};

export const validateRequestedProperties = (
  queryParams: QueryParams,
  requestableProperties: Column[], // provided by endpoint config
  parquetColumns: { [K in Column]?: string },
  res: Response,
): boolean => {
  const requestedProperties = queryParams.properties
    ?.split(',')
    .map(p => p as Column)
    .filter(p => !!p) ?? [];
  if (requestedProperties.length === 0) {
    res.status(400).send({ error: "At least one property must be requested." });
    return false;
  }
  const availableColumns = Object.keys(parquetColumns);
  const invalid = requestedProperties.find((p) => {
    return !requestableProperties.includes(p) || !availableColumns.includes(p);
  });
  if (invalid) {
    res.status(400).send({ error: `Invalid property requested: ${invalid}` });
    return false;
  }
  return true;
};

// The release-version validators below are intended to guard against SQL injection
// by checking the requested version is a filepath within the relevant data directory.

export const validateModelRelease = (modelVersion: string, res: Response): boolean => {
  if (!modelVersions.includes(modelVersion)) {
    res.status(400).send({ error: `Invalid model release: ${modelVersion}` });
    return false;
  }
  return true;
};

export const validateDataRelease = (req: Request, res: Response): boolean => {
  const dataVersion = req.query['data_release'] as string;

  if (!dataVersions.includes(dataVersion)) {
    res.status(400).send({ error: `Invalid data release requested: ${dataVersion}` });
    return false;
  }
  return true;
};

export const validateDateParams = (req: Request, res: Response): boolean => {
  const queryParams = req.query as Record<string, string | undefined>;

  for (const param of ["date", "date_from", "date_to"]) {
    if (queryParams[param] && !dateRegex.test(queryParams[param]!)) {
      res.status(400).send({ error: `Invalid date format for parameter '${param}'. Expected YYYY-MM-DD.` });
      return false;
    }
  }

  const date_from = queryParams.date_from;
  const date_to = queryParams.date_to;

  if ((date_from && !date_to) || (date_to && !date_from)) {
    res.status(400).send({ error: "Only one of 'date_to' and 'date_from' was specified." });
    return false;
  }

  if (date_from && date_to && new Date(date_from) > new Date(date_to)) {
    res.status(400).send({ error: "'date_from' cannot be later than 'date_to'." });
    return false;
  }
  return true;
};

export const validateDateIsFirstOfMonth = (req: Request, res: Response): boolean => {
  const date = req.query['date'] as string | undefined;
  if (date && new Date(date).getDate() !== 1) {
    res.status(400).send({ error: "Invalid `date` parameter. The date must be the first of a month." });
    return false;
  }
  return true;
};

export const validateAdminLevel = (req: Request, res: Response): boolean => {
  const adminLevel = req.query['admin_level'] as string | undefined;
  if (!adminLevel || !adminLevels.includes(adminLevel)) {
    res.status(400).send({ error: `Invalid admin level requested: ${adminLevel}` });
    return false;
  }
  // Validate admin_level against admin0, admin1, admin2 parameters if they exist.
  for (const level of adminLevels) {
    if (req.query[`admin${level}`] && Number(adminLevel) < Number(level)) {
      res.status(400).send({
        error: "You cannot request results at a less granular level than that of the containing region.",
      });
      return false;
    }
  }
  return true;
};

