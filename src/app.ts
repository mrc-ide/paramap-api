import express, { type Express, type Request, type Response } from 'express';
import { connection } from './queryEngine.ts';
import config from './config/config.ts';
import { errorHandler } from './middlewares/errorHandler.ts';
import { requestTimingLogger } from './middlewares/requestTimingLogger.ts';
import { adminLevels, globalBounds, modelVersions } from './constants.ts';
import type { Mutation, QueryParams } from './types.ts';
import { validateAdmin0, validateDataRelease, validateDateParams, validateModelRelease } from './utils/validators.ts';
import { executeParquetQuery } from './utils/queryHelpers.ts';

// TODO: add compression in nginx.

// Noting an assumption: the date range per variant will be the same across all admin levels.

const app: Express = express();
app.use(requestTimingLogger);

// Can be called with or without a model_release parameter.
// If no model_release parameter, defaults to latest.
app.get('/metadata', async (req: Request, res: Response) => {
  const modelVersion = validateModelRelease(req, res);

  // Get unique genetic variants and their associated genes and mutations.
  // All from the model outputs rectangle, using the latest model version.
  const uniqueVariants = await connection.runAndReadAll(`
    SELECT
      ANY_VALUE(gene) AS gene,
      ANY_VALUE(mutation) AS mutation,
      variant,
      STRFTIME(MIN("date"), '%Y-%m-%d') AS min_date,
      STRFTIME(MAX("date"), '%Y-%m-%d') AS max_date
    FROM 'data/model/${modelVersion}/admin0.parquet'
    GROUP BY variant
  `);

  // Group the unique variants by gene, so that we can return a list of mutations for each gene in the metadata endpoint.
  const mutationsByGene = uniqueVariants.getRowObjects().reduce((acc, row) => {
    const gene = row.gene as string;
    const mutationObj = {
      mutation: row.mutation,
      date_range: {
        start: row.min_date,
        end: row.max_date,
      },
    } as Mutation;
    const existingGene = acc.find(g => g.gene === gene);
    if (existingGene) {
      existingGene.mutations.push(mutationObj);
    } else {
      acc.push({
        gene,
        mutations: [mutationObj],
      });
    }
    return acc;
  }, [] as { gene: string, mutations: Mutation[] }[]);

  const { default: modelMetadata } = await import(`../data/model/${modelVersion}/metadata.json`, { with: { type: "json" } });
  const dataVersion = modelMetadata.data_release;

  res.send({
    model_releases: modelVersions,
    prevalences: {
      version: modelVersion,
      data_release: dataVersion,
      variants: mutationsByGene,
    },
    bounds: globalBounds,
  });
});

// TODO: tell time columns to be time columns - https://duckdb.org/2024/12/18/duckdb-node-neo-client#binding-values-to-prepared-statements

app.get('/surveys', async (req: Request, res: Response) => {
  // TODO: type queryParams for this endpoint and validate all params (don't allow unrecognised params)
  const queryParams = req.query as QueryParams;
  if (!queryParams.data_release) {
    res.status(400).send({ error: "Missing required query parameter: data_release" });
    return;
  }

  const dataVersion = validateDataRelease(req, res);
  if (!dataVersion) {
    return;
  }

  validateDateParams(req, res);
  validateAdmin0(req, res);

  const surveyDataParquet = `data/stave/${dataVersion}/survey_data.parquet`;

  const result = await executeParquetQuery(queryParams, "/surveys", surveyDataParquet, res);
  if (!result) {
    return;
  }

  res.type("json").send(result.getRowObjectsJson());
});

app.get('/prevalences', async (req: Request, res: Response) => {
  // TODO: type queryParams for this endpoint and validate all params (don't allow unrecognised params)
  const queryParams = req.query as QueryParams;

  if (!queryParams.model_release) {
    res.status(400).send({ error: "Missing required query parameter: model_release" });
    return;
  }

  const modelVersion = validateModelRelease(req, res);
  if (!modelVersion) {
    return;
  }

  const { date } = validateDateParams(req, res) ?? {};

  // Check the date is the first of a month
  if (date && new Date(date).getDate() !== 1) {
    res.status(400).send({ error: "Invalid `date` parameter. The date must be the first of a month." });
    return;
  }

  validateAdmin0(req, res);

  // Client may request results at any of the available levels of granularity.
  const adminLevel = queryParams.admin_level;
  if (!adminLevel) {
    res.status(400).send({ error: "Missing required query parameter: admin_level" });
    return;
  }
  if (!adminLevels.includes(adminLevel)) {
    res.status(400).send({ error: `Invalid admin level requested: ${adminLevel}` });
    return;
  }

  const prevalencesParquet = `data/model/${modelVersion}/admin${adminLevel}.parquet`;

  for (const level of adminLevels) {
    if (queryParams[`admin${level}`] && adminLevel < level) {
      res.status(400).send({ error: "You cannot request results at a less granular level than that of the containing region." });
      return;
    }
  }

  const result = await executeParquetQuery(queryParams, "/prevalences", prevalencesParquet, res);
  if (!result) {
    return;
  }

  res.type("json").send(result.getColumnsObjectJson());
});

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
