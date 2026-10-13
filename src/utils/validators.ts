import { type Request } from 'express';
import { modelVersions, dataVersions, adminLevels } from '../constants.ts';
import type { Column } from '../types.ts';
import { getDataRelease, getModelRelease } from './releases.ts';
import { endpointConfigs, type DateFormat, type Endpoint } from './endpoints.ts';
import { getQueryParamStr } from './query.ts';
import { AppError } from '../middlewares/errorHandler.ts';

const dateRegexes: Record<DateFormat, RegExp> = {
  "YYYY-MM": /^(19|20)\d{2}-(0[1-9]|1[0-2])$/,
  "YYYY-MM-DD": /^(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
};

export const validateRequiredQueryParams = (
  req: Request,
) => {
  const path = req.path as Endpoint;
  const missingParams = endpointConfigs[path].requiredParams.filter(param => !req.query[param]);
  if (missingParams.length > 0) {
    throw new AppError(`Missing required query parameters: ${missingParams.join(', ')}`, 400);
  }
};

export const validateRequestedProperties = (
  requestedProperties: string[],
  requestableProperties: Column[], // provided by endpoint config
  parquetColumns: { [K in Column]?: string },
) => {
  if (requestedProperties.length === 0) {
    throw new AppError("At least one property must be requested.", 400);
  }
  const availableColumns = Object.keys(parquetColumns);
  const invalid = requestedProperties.find((p) => {
    return !(requestableProperties as string[]).includes(p) || !availableColumns.includes(p);
  });
  if (invalid) {
    throw new AppError(`Invalid property requested: ${invalid}`, 400);
  }
};

// The release-version validators below are intended to guard against SQL injection
// by checking the requested version is a filepath within the relevant data directory.

export const validateModelRelease = (req: Request) => {
  const modelVersion = getModelRelease(req.query);
  if (!modelVersions.includes(modelVersion)) {
    throw new AppError(`Unknown model release: ${modelVersion}`, 404);
  }
};

export const validateDataRelease = (req: Request) => {
  const dataVersion = getDataRelease(req.query);
  if (!dataVersions.includes(dataVersion)) {
    throw new AppError(`Unknown data release requested: ${dataVersion}`, 404);
  }
};

export const validateDateParams = (req: Request) => {
  const path = req.path as Endpoint;
  const dateFormat = endpointConfigs[path].dateFormat;

  for (const param of ["date", "date_from", "date_to"]) {
    const value = getQueryParamStr(req.query, param);
    if (!value) continue;
    const isValid = dateRegexes[dateFormat].test(value);
    if (!isValid) {
      throw new AppError(`Invalid date for parameter '${param}'. Expected ${dateFormat}.`, 400);
    }
  }

  const [dateFrom, dateTo] = ["date_from", "date_to"].map(p => getQueryParamStr(req.query, p));

  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new AppError("'date_from' cannot be later than 'date_to'.", 400);
  }
};

export const validateAdminLevel = (req: Request) => {
  const adminLevel = getQueryParamStr(req.query, "admin_level");
  if (!adminLevel || !adminLevels.includes(adminLevel)) {
    throw new AppError(`Invalid admin level requested: ${adminLevel}`, 400);
  }
  // Validate admin_level against admin0, admin1, admin2 parameters if they exist.
  for (const level of adminLevels) {
    if (getQueryParamStr(req.query, `admin${level}`) && Number(adminLevel) < Number(level)) {
      throw new AppError("You cannot request results at a less granular level than that of the containing region.", 400);
    }
  }
};
