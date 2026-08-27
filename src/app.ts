import express, { type Express, type Request, type Response } from 'express';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import config from './config/config.ts';
import { errorHandler } from './middlewares/errorHandler.ts';
// import { requestTimingLogger } from './middlewares/requestTimingLogger.ts';
import { PREVALENCE_COLUMNS, SURVEY_COLUMNS, globalBounds, modelVersions } from './constants.ts';
import type { QueryParams } from './types.ts';
import { validateAdmin0, validateAdminLevel, validateDataRelease, validateDateIsFirstOfMonth, validateDateParams, validateModelRelease, validateRequiredQueryParams } from './utils/validators.ts';
import { executeParquetQuery } from './utils/dataHelpers.ts';
import { getMutationsByGene } from './utils/metadataHelpers.ts';

export const createApp = (): Express => {
  const app: Express = express();
  // app.use(requestTimingLogger);

  // Can be called with or without a model_release parameter.
  // If no model_release parameter, defaults to latest.
  app.get('/metadata', async (req: Request, res: Response) => {
    const modelVersion = (req.query['model_release'] ?? config.latestModelVersion) as string;
    if (!validateModelRelease(modelVersion, res)) return;

    const mutationsByGene = await getMutationsByGene(modelVersion);
    const metadataPath = pathToFileURL(resolve(config.dataDir, "model", modelVersion, "metadata.json")).href;
    const { default: modelMetadata } = await import(metadataPath, { with: { type: "json" } });
    const dataVersion = modelMetadata.data_release;

    res.send({
      model_releases: modelVersions,
      prevalences: {
        version: modelVersion,
        data_release: dataVersion,
        variants: mutationsByGene,
      },
      bounds: globalBounds.bounds,
    });
  });

  app.get('/surveys', async (req: Request, res: Response) => {
    const requiredParams = [
      "data_release",
      "properties",
      SURVEY_COLUMNS.GENE,
      SURVEY_COLUMNS.MUTATION,
    ];
    if (!validateRequiredQueryParams(req, res, requiredParams)
      || !validateDataRelease(req, res)
      || !validateDateParams(req, res)
      || !validateAdmin0(req, res)
    ) return;

    const dataVersion = req.query['data_release'] as string;
    const surveyDataParquet = join(config.dataDir, "stave", dataVersion, "survey_data.parquet");

    const result = await executeParquetQuery(req.query as QueryParams, "/surveys", surveyDataParquet, res);
    if (!result) return;

    res.type("json").send(result.getRowObjectsJson());
  });

  app.get('/prevalences', async (req: Request, res: Response) => {
    const queryParams = req.query as QueryParams;
    // TODO: consider allowing this endpoint to have a default model release

    const requiredParams = [
      "model_release",
      "admin_level",
      "properties",
      PREVALENCE_COLUMNS.GENE,
      PREVALENCE_COLUMNS.MUTATION,
    ];
    if (!validateRequiredQueryParams(req, res, requiredParams)
      || !validateModelRelease(queryParams.model_release!, res)
      || !validateDateParams(req, res)
      || !validateDateIsFirstOfMonth(req, res)
      || !validateAdminLevel(req, res)
      || !validateAdmin0(req, res)
    ) return;

    // Client may request results at any of the available levels of granularity.
    const adminLevel = queryParams.admin_level as string;
    const prevalencesParquet = join(config.dataDir, "model", queryParams.model_release!, `admin${adminLevel}.parquet`);

    const result = await executeParquetQuery(queryParams, "/prevalences", prevalencesParquet, res);
    if (!result) return;

    res.type("json").send(result.getColumnsObjectJson());
  });

  app.use(errorHandler);

  return app;
};
