import express, { type Express, type Request, type Response } from 'express';
import { errorHandler } from './middlewares/errorHandler.ts';
import { modelVersions } from './constants.ts';
import { validateModelRelease } from './utils/validators.ts';
import { getDataRelease, getModelRelease, readModelMetadata } from './utils/releases.ts';
import { validateSurveysRequest, validatePrevalencesRequest } from './utils/endpoints.ts';
import { executeParquetQuery, prevalencesParquet, surveyDataParquet } from './utils/data.ts';
import { getMutationsByGene, globalBounds } from './utils/metadata.ts';
import { getQueryParamStr } from './utils/query.ts';

export const createApp = (): Express => {
  const app: Express = express();

  app.get('/metadata', async (req: Request, res: Response) => {
    validateModelRelease(req);

    const modelVersion = getModelRelease(req.query);
    const modelMetadata = await readModelMetadata(modelVersion);

    res.send({
      model_releases: modelVersions,
      prevalences: {
        version: modelVersion,
        dependencies: {
          data_release: modelMetadata.data_release,
          shapefile_source: modelMetadata.shapefile_source,
        },
        variants: await getMutationsByGene(modelVersion),
      },
      bounds: await globalBounds(modelVersion),
    });
  });

  app.get('/surveys', async (req: Request, res: Response) => {
    validateSurveysRequest(req);

    const dataVersion = getDataRelease(req.query);
    const surveyDataParquetPath = surveyDataParquet(dataVersion);
    const result = await executeParquetQuery(req.query, "/surveys", surveyDataParquetPath);

    res.type("json").send(result.getRowObjectsJson());
  });

  app.get('/prevalences', async (req: Request, res: Response) => {
    validatePrevalencesRequest(req);

    const modelVersion = getModelRelease(req.query);

    const adminLevel = getQueryParamStr(req.query, "admin_level") as string;
    const prevalencesParquetPath = prevalencesParquet(modelVersion, adminLevel);
    const result = await executeParquetQuery(req.query, "/prevalences", prevalencesParquetPath)!;

    res.type("json").send(result.getColumnsObjectJson());
  });

  app.use(errorHandler);

  return app;
};
