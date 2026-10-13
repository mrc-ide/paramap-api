import type { Request } from 'express';
import { validateRequiredQueryParams, validateDataRelease, validateDateParams, validateModelRelease, validateAdminLevel } from './validators.ts';
import type { Column } from '../types.ts';
import { PREVALENCE_COLUMNS, SURVEY_COLUMNS } from '../constants.ts';

export const validateSurveysRequest = (req: Request) => {
  return validateRequiredQueryParams(req)
    && validateDataRelease(req)
    && validateDateParams(req);
};

export const validatePrevalencesRequest = (req: Request) => {
  return validateRequiredQueryParams(req)
    && validateModelRelease(req)
    && validateDateParams(req)
    && validateAdminLevel(req)
};

export type Endpoint = "/surveys" | "/prevalences";
export type DateFormat = "YYYY-MM" | "YYYY-MM-DD";
export interface EndpointConfig<T extends Column = Column> {
  // Query parameters that must be present in the request.
  requiredParams: string[];
  // An allow-list of properties that clients may request as columns.
  requestableProperties: T[];
  // Query parameters that may be used to filter the rows.
  filterableParams: string[];
  // The column to filter on for requests that scope by date_from/date_to.
  dateColumn: T;
  dateFormat: DateFormat;
}

export const endpointConfigs: Record<Endpoint, EndpointConfig> = {
  "/surveys": {
    requiredParams: [
      "properties",
      SURVEY_COLUMNS.GENE,
      SURVEY_COLUMNS.MUTATION,
    ],
    requestableProperties: Object.values(SURVEY_COLUMNS),
    filterableParams: ["bbox", "survey_id", "date_from", "date_to", "gene", "mutation"],
    dateColumn: "collection_day",
    dateFormat: "YYYY-MM-DD",
  },
  "/prevalences": {
    requiredParams: [
      "admin_level",
      "properties",
      PREVALENCE_COLUMNS.GENE,
      PREVALENCE_COLUMNS.MUTATION,
    ],
    requestableProperties: Object.values(PREVALENCE_COLUMNS),
    filterableParams: ["admin0", "admin1", "admin2", "gene", "mutation", "date", "date_from", "date_to"],
    dateColumn: "date",
    dateFormat: "YYYY-MM",
  },
} as const;
