import type { Request, Response } from 'express';
import { validateRequiredQueryParams, validateDataRelease, validateDateParams, validateModelRelease, validateDateIsFirstOfMonth, validateAdminLevel } from './validators.ts';
import type { Column } from '../types.ts';
import { PREVALENCE_COLUMNS, SURVEY_COLUMNS } from '../constants.ts';

export const validateSurveysRequest = (req: Request, res: Response) => {
  return validateRequiredQueryParams(req, res)
    && validateDataRelease(req, res)
    && validateDateParams(req, res);
};

export const validatePrevalencesRequest = (req: Request, res: Response) => {
  return validateRequiredQueryParams(req, res)
    && validateModelRelease(req.query['model_release'] as string, res)
    && validateDateParams(req, res)
    && validateDateIsFirstOfMonth(req, res)
    && validateAdminLevel(req, res)
};

// column mode: filter on the admin0 column directly.
// bounds mode: translate the admin0 ISO code into lat/lng bounding-boxes.
// Survey data does not come with region metadata, so we filter it by lat/lng.
const Admin0Mode = {
  BOUNDS: "bounds",
  COLUMN: "column",
} as const;
type Admin0Mode = typeof Admin0Mode[keyof typeof Admin0Mode];

export type Endpoint = "/surveys" | "/prevalences";
export interface EndpointConfig<T extends Column = Column> {
  // Query parameters that must be present in the request.
  requiredParams: string[];
  // An allow-list of properties that clients may request as columns.
  requestableProperties: T[];
  // Query parameters that may be used to filter the rows.
  filterableParams: string[];
  // The column to filter on for requests that scope by date_from/date_to.
  dateColumn: T;
  admin0Mode: Admin0Mode;
}

export const endpointConfigs: Record<Endpoint, EndpointConfig> = {
  "/surveys": {
    requiredParams: [
      "data_release",
      "properties",
      SURVEY_COLUMNS.GENE,
      SURVEY_COLUMNS.MUTATION,
    ],
    requestableProperties: Object.values(SURVEY_COLUMNS),
    filterableParams: ["admin0", "survey_id", "date_from", "date_to", "gene", "mutation"],
    dateColumn: "collection_day",
    admin0Mode: "bounds",
  },
  "/prevalences": {
    requiredParams: [
      "model_release",
      "admin_level",
      "properties",
      PREVALENCE_COLUMNS.GENE,
      PREVALENCE_COLUMNS.MUTATION,
    ],
    requestableProperties: Object.values(PREVALENCE_COLUMNS),
    filterableParams: ["admin0", "admin1", "admin2", "gene", "mutation", "date", "date_from", "date_to"],
    dateColumn: "date",
    admin0Mode: "column",
  },
} as const;
