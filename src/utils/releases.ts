import type { Request } from "express";
import { readFile } from "node:fs/promises";
import semver from "semver";
import { join } from "node:path";
import config from "../config.ts";
import { modelVersions } from "../constants.ts";

export interface ModelMetadata {
  version: string;
  data_release: string;
  shapefile_source: string;
}

export const readModelMetadata = async (modelVersion: string): Promise<ModelMetadata> => {
  const metadataPath = join(config.dataDir, "model", modelVersion, "metadata.json");
  return JSON.parse(await readFile(metadataPath, "utf8")) as ModelMetadata;
};

const latestModelRelease = semver.rsort([...modelVersions])[0];

// Each model release depends on a specific data release, so the default data release
// is the one that the default model release depends on.
export const defaultDataRelease = (await readModelMetadata(latestModelRelease)).data_release;

export const getModelRelease = (req: Request): string =>
  (req.query['model_release'] ?? latestModelRelease) as string;

export const getDataRelease = (req: Request): string =>
  (req.query['data_release'] ?? defaultDataRelease) as string;
