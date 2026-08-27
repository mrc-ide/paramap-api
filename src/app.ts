import express, { type Express, type Request, type Response } from 'express';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import config from './config/config.ts';
import { errorHandler } from './middlewares/errorHandler.ts';
// import { requestTimingLogger } from './middlewares/requestTimingLogger.ts';
import { globalBounds, modelVersions } from './constants.ts';
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
    if (!validateModelRelease(req, res)) {
      res.end();
      return;
    }

    const modelVersion = (req.query['model_release'] ?? config.latestModelVersion) as string;
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
    const requiredParams = ['data_release', 'gene', 'mutation', 'properties'];
    if (!validateRequiredQueryParams(req, res, requiredParams)
      || !validateDataRelease(req, res)
      || !validateDateParams(req, res)
      || !validateAdmin0(req, res)
    ) {
      res.end();
      return;
    }

    const dataVersion = req.query['data_release'] as string;
    const surveyDataParquet = join(config.dataDir, "stave", dataVersion, "survey_data.parquet");

    const result = await executeParquetQuery(req.query as QueryParams, "/surveys", surveyDataParquet, res);
    if (!result) {
      res.end();
      return;
    }

    res.type("json").send(result.getRowObjectsJson());
  });

  app.get('/prevalences', async (req: Request, res: Response) => {
    const requiredParams = ['model_release', 'admin_level', 'gene', 'mutation', 'properties'];
    if (!validateRequiredQueryParams(req, res, requiredParams)
      || !validateModelRelease(req, res)
      || !validateDateParams(req, res)
      || !validateDateIsFirstOfMonth(req, res)
      || !validateAdminLevel(req, res)
      || !validateAdmin0(req, res)
    ) {
      res.end();
      return;
    }

    const queryParams = req.query as QueryParams;
    // Client may request results at any of the available levels of granularity.
    const adminLevel = queryParams.admin_level as string;
    const modelVersion = queryParams.model_release as string;
    const prevalencesParquet = join(config.dataDir, "model", modelVersion, `admin${adminLevel}.parquet`);

    const result = await executeParquetQuery(queryParams, "/prevalences", prevalencesParquet, res);
    if (!result) {
      res.end();
      return;
    }

    res.type("json").send(result.getColumnsObjectJson());
  });

  app.use(errorHandler);

  return app;
};
