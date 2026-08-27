import { readdir } from "fs/promises";
import { join } from "node:path";
import config from "./config/config.ts";

export const adminLevels = ["0", "1", "2"];

export const globalBounds = {
  "bounds": {
    "min": {
      "lng": -70.0635,
      "lat": 12.4124
    },
    "max": {
      "lng": -69.8654,
      "lat": 12.624
    }
  }
};

export const SURVEY_COLUMNS = {
  COLLECTION_DAY: "collection_day",
  COLLECTION_END: "collection_end",
  COLLECTION_START: "collection_start",
  CONTRIBUTORS: "contributors",
  DENOMINATOR: "denominator",
  GENE: "gene",
  LAT: "lat",
  LNG: "lng",
  MUTATION: "mutation",
  NUMERATOR: "numerator",
  PREVALENCE_LOWER: "prevalence_lower",
  PREVALENCE_UPPER: "prevalence_upper",
  PREVALENCE: "prevalence",
  REFERENCE_YEAR: "reference_year",
  REFERENCE: "reference",
  SITE_NAME: "site_name",
  STUDY_ID: "study_id",
  STUDY_LABEL: "study_label",
  SURVEY_ID: "survey_id",
  VARIANT: "variant",
} as const;

export const PREVALENCE_COLUMNS = {
  ADMIN_LEVEL: "admin_level",
  ADMIN0: "admin0",
  ADMIN1: "admin1",
  ADMIN2: "admin2",
  DATE: "date",
  EXCEEDANCE_1: "exceedance_1",
  EXCEEDANCE_10: "exceedance_10",
  EXCEEDANCE_2: "exceedance_2",
  EXCEEDANCE_5: "exceedance_5",
  GENE: "gene",
  LOWER_95: "lower_95",
  MEAN: "mean",
  MEDIAN: "median",
  MUTATION: "mutation",
  NEAREST_SURVEY_BY_DATE: "nearest_survey_by_date",
  NO_OF_INFORMING_SURVEYS: "no_of_informing_surveys",
  SD: "SD",
  UPPER_95: "upper_95",
} as const;

const staveFiles = await readdir(join(config.dataDir, "stave"), { withFileTypes: true });
export const dataVersions = staveFiles
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);

const modelFiles = await readdir(join(config.dataDir, "model"), { withFileTypes: true });
export const modelVersions = modelFiles
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);
