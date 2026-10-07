import { type Request, type Response } from 'express';
import { modelVersions, dataVersions, adminLevels } from '../constants.ts';
import type { Column } from '../types.ts';
import { getDataRelease, getModelRelease } from './releases.ts';
import { endpointConfigs, type DateFormat, type Endpoint } from './endpoints.ts';
import { sendErrorResponse } from './helpers.ts';

const dateRegexes: Record<DateFormat, RegExp> = {
  "YYYY-MM": /^(19|20)\d{2}-(0[1-9]|1[0-2])$/,
  "YYYY-MM-DD": /^(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
};

export const validateRequiredQueryParams = (
  req: Request,
  res: Response,
): boolean => {
  const path = req.path as Endpoint;
  const missingParams = endpointConfigs[path].requiredParams.filter(param => !req.query[param]);
  if (missingParams.length > 0) {
    sendErrorResponse(res, `Missing required query parameters: ${missingParams.join(', ')}`, 400);
    return false;
  }
  return true;
};

export const validateRequestedProperties = (
  requestedProperties: string[],
  requestableProperties: Column[], // provided by endpoint config
  parquetColumns: { [K in Column]?: string },
  res: Response,
): boolean => {
  if (requestedProperties.length === 0) {
    sendErrorResponse(res, "At least one property must be requested.", 400);
    return false;
  }
  const availableColumns = Object.keys(parquetColumns);
  const invalid = requestedProperties.find((p) => {
    return !(requestableProperties as string[]).includes(p) || !availableColumns.includes(p);
  });
  if (invalid) {
    sendErrorResponse(res, `Invalid property requested: ${invalid}`, 400);
    return false;
  }
  return true;
};

// The release-version validators below are intended to guard against SQL injection
// by checking the requested version is a filepath within the relevant data directory.

export const validateModelRelease = (req: Request, res: Response): boolean => {
  const modelVersion = getModelRelease(req);
  if (!modelVersions.includes(modelVersion)) {
    sendErrorResponse(res, `Unknown model release: ${modelVersion}`, 404);
    return false;
  }
  return true;
};

export const validateDataRelease = (req: Request, res: Response): boolean => {
  const dataVersion = getDataRelease(req);
  if (!dataVersions.includes(dataVersion)) {
    sendErrorResponse(res, `Unknown data release requested: ${dataVersion}`, 404);
    return false;
  }
  return true;
};

export const validateDateParams = (req: Request, res: Response): boolean => {
  const path = req.path as Endpoint;
  const dateFormat = endpointConfigs[path].dateFormat;
  const queryParams = req.query as Record<string, string | undefined>;

  for (const param of ["date", "date_from", "date_to"]) {
    const value = queryParams[param];
    if (!value) continue;
    const isValid = dateRegexes[dateFormat].test(value);
    if (!isValid) {
      sendErrorResponse(res, `Invalid date for parameter '${param}'. Expected ${dateFormat}.`, 400);
      return false;
    }
  }

  const date_from = queryParams.date_from;
  const date_to = queryParams.date_to;

  if (date_from && date_to && date_from > date_to) {
    sendErrorResponse(res, "'date_from' cannot be later than 'date_to'.", 400);
    return false;
  }
  return true;
};

export const validateAdminLevel = (req: Request, res: Response): boolean => {
  const adminLevel = req.query['admin_level'] as string | undefined;
  if (!adminLevel || !adminLevels.includes(adminLevel)) {
    sendErrorResponse(res, `Invalid admin level requested: ${adminLevel}`, 400);
    return false;
  }
  // Validate admin_level against admin0, admin1, admin2 parameters if they exist.
  for (const level of adminLevels) {
    if (req.query[`admin${level}`] && Number(adminLevel) < Number(level)) {
      sendErrorResponse(res, "You cannot request results at a less granular level than that of the containing region.", 400);
      return false;
    }
  }
  return true;
};
