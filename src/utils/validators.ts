import { type Request, type Response } from 'express';
import { LATEST_MODEL_VERSION, modelVersions, dataVersions, dateRegex, adminLevels } from '../constants.ts';
import type { QueryParams } from '../types.ts';

export const validateRequiredQueryParams = (req: Request, res: Response, requiredParams: string[]): boolean => {
  const missingParams = requiredParams.filter(param => !req.query[param]);
  if (missingParams.length > 0) {
    res.status(400).send({ error: `Missing required query parameters: ${missingParams.join(', ')}` });
    return false;
  }
  return true;
}

// Parse and validate the requested properties, returning an array of valid properties or sending a 400 response and returning null on failure.
export const validateRequestedProperties = (
  queryParams: QueryParams,
  requestableProperties: string[], // provided by endpoint config
  parquetColumns: Record<string, string>,
  res: Response,
): string[] | null => {
  const requestedProperties = queryParams.properties?.split(',').filter(p => !!p) ?? [];
  if (requestedProperties.length === 0) {
    res.status(400).send({ error: "At least one property must be requested." });
    return null;
  }
  const availableColumns = Object.keys(parquetColumns);
  const invalid = requestedProperties.find(p => !requestableProperties.includes(p) || !availableColumns.includes(p));
  if (invalid) {
    res.status(400).send({ error: `Invalid property requested: ${invalid}` });
    return null;
  }
  return requestedProperties;
};

export const validateModelRelease = (req: Request, res: Response): boolean => {
  const modelVersion = (req.query['model_release'] ?? LATEST_MODEL_VERSION) as string;

  // Security against SQL injection: Validate that the above is a filepath within the expected data directory,
  // by comparing it against a list of the actual prevalence data releases in the data/model directory.
  if (!modelVersions.includes(modelVersion)) {
    res.status(400).send({ error: `Invalid model release: ${modelVersion}` });
    return false;
  }
  return true;
};

export const validateDataRelease = (req: Request, res: Response): boolean => {
  const dataVersion = req.query['data_release'] as string;

  // Security against SQL injection: Validate that the above is a filepath within the expected data directory,
  // by comparing it against a list of the actual survey data releases in the data/stave directory.
  if (!dataVersions.includes(dataVersion)) {
    res.status(400).send({ error: `Invalid data release requested: ${dataVersion}` });
    return false;
  }
  return true;
};

export const validateDateParams = (req: Request, res: Response): boolean => {
  const queryParams = req.query as Record<string, string | undefined>;
  const date_from = queryParams.date_from;
  const date_to = queryParams.date_to;

  for (const param of ["date", "date_from", "date_to"]) {
    if (queryParams[param] && !dateRegex.test(queryParams[param]!)) {
      res.status(400).send({ error: `Invalid date format for parameter '${param}'. Expected YYYY-MM-DD.` });
      return false;
    }
  }

  if (date_from && !date_to) {
    res.status(400).send({ error: "Missing required parameter 'date_to' when 'date_from' is specified." });
    return false;
  }

  if (date_to && !date_from) {
    res.status(400).send({ error: "Missing required parameter 'date_from' when 'date_to' is specified." });
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
  if (!adminLevel) {
    res.status(400).send({ error: "Missing required query parameter: admin_level" });
    return false;
  }
  if (!adminLevels.includes(adminLevel)) {
    res.status(400).send({ error: `Invalid admin level requested: ${adminLevel}` });
    return false;
  }
  // Validate admin_level against admin0, admin1, admin2 parameters if they exist.
  for (const level of adminLevels) {
    if (req.query[`admin${level}`] && Number(adminLevel) < Number(level)) {
      res.status(400).send({ error: "You cannot request results at a less granular level than that of the containing region." });
      return false;
    }
  }
  return true;
};

export const validateAdmin0 = (req: Request, res: Response): boolean => {
  const admin0 = req.query['admin0'];

  if (admin0 && !/^[A-Z]{3}$/.test(admin0 as string)) {
    res.status(400).send({ error: "Invalid ISO code for parameter 'admin0'. Expected a 3-letter uppercase ISO code." });
    return false;
  }
  return true;
};
