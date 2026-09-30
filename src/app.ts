import express, { type Express, type Request, type Response } from 'express';
import { join } from 'node:path';
import config from './config/config.ts';
import { errorHandler } from './middlewares/errorHandler.ts';
import { globalBounds, modelVersions } from './constants.ts';
import type { QueryParams } from './types.ts';
import { validateModelRelease } from './utils/validators.ts';
import { getDataRelease, getModelRelease, readModelMetadata } from './utils/releases.ts';
import { validateSurveysRequest, validatePrevalencesRequest } from './utils/endpoints.ts';
import { executeParquetQuery } from './utils/data.ts';
import { getMutationsByGene } from './utils/metadata.ts';

export const createApp = (): Express => {
  const app: Express = express();

  app.get('/metadata', async (req: Request, res: Response) => {
    if (!validateModelRelease(req, res)) return;

    const modelVersion = getModelRelease(req);
    const mutationsByGene = await getMutationsByGene(modelVersion);
    const modelMetadata = await readModelMetadata(modelVersion);
    const dataVersion = modelMetadata.data_release;

    res.send({
      model_releases: modelVersions,
      prevalences: {
        version: modelVersion,
        dependencies: {
          data_release: dataVersion,
          shapefile_source: modelMetadata.shapefile_source,
        },
        variants: mutationsByGene,
      },
      bounds: globalBounds.bounds,
    });
  });

  app.get('/surveys', async (req: Request, res: Response) => {
    if (!validateSurveysRequest(req, res)) return;

    const dataVersion = getDataRelease(req);
    const surveyDataParquet = join(config.dataDir, "stave", dataVersion, "survey_data.parquet");

    const result = await executeParquetQuery(req.query as QueryParams, "/surveys", surveyDataParquet, res);
    if (!result) return;

    res.type("json").send(result.getRowObjectsJson());
  });

  app.get('/prevalences', async (req: Request, res: Response) => {
    if (!validatePrevalencesRequest(req, res)) return;

    const modelVersion = getModelRelease(req);
    const queryParams = req.query as QueryParams;

    // Client may request results at any of the available levels of granularity.
    const adminLevel = queryParams.admin_level as string;
    const prevalencesParquet = join(config.dataDir, "model", modelVersion, `admin${adminLevel}.parquet`);

    const result = await executeParquetQuery(queryParams, "/prevalences", prevalencesParquet, res);
    if (!result) return;

    res.type("json").send(result.getColumnsObjectJson());
  });

  app.use(errorHandler);

  return app;
};
