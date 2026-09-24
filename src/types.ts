import type { PREVALENCE_COLUMNS, SURVEY_COLUMNS } from "./constants.ts";

export interface Mutation {
  mutation: string;
  date_range: {
    start: string;
    end: string;
  };
}

export type QueryParams = Record<string, string | undefined>;

export const metadataQueryParams = {} as QueryParams;

export type SurveyColumn = typeof SURVEY_COLUMNS[keyof typeof SURVEY_COLUMNS];
export type PrevalenceColumn = typeof PREVALENCE_COLUMNS[keyof typeof PREVALENCE_COLUMNS];
export type Column = SurveyColumn | PrevalenceColumn;
