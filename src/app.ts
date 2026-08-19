import express, { type Express, type Request, type Response } from 'express';
import { DuckDBInstance } from '@duckdb/node-api';
import config from './config/config.ts';
import { errorHandler } from './middlewares/errorHandler.ts';
import { requestTimingLogger } from './middlewares/requestTimingLogger.ts';
import admin0RegionMetadata from '../data/admin0-region-metadata.json' with { type: "json" };
import { adminLevels, dateRegex, LATEST_MODEL_VERSION, globalBounds, modelVersions, dataVersions } from './utils.ts';
import type { Mutation } from './types.ts';

// TODO: add compression in nginx.

const instance = await DuckDBInstance.create(':memory:', {
  parquet_metadata_cache: "true",
});
const connection = await instance.connect();

// Noting an assumption: the date range per variant will be the same across all admin levels.


// On creating with in-memory database: https://duckdb.org/docs/current/clients/node_neo/overview#create-instance
// DuckDB can operate in both persistent mode, where the data is saved to disk, and in in-memory mode, where the entire dataset is stored in the main memory.
// Both persistent and in-memory databases use spilling to disk to facilitate larger-than-memory workloads (i.e., out-of-core-processing).
// In in-memory mode, no data is persisted to disk, therefore, all data is lost when the process finishes.

// We can do partial resolution of queries using streaming, see https://duckdb.org/docs/current/clients/node_neo

const app: Express = express();
app.use(requestTimingLogger);
app.use(errorHandler);

// Can be called with or without a model_release parameter.
// If no model_release parameter, defaults to latest.
app.get('/metadata', async (req: Request, res: Response) => {
  const modelVersion = req.query['model_release'] ?? LATEST_MODEL_VERSION;

  // Security: Validate that the above is a filepath within the expected data directory,
  // by comparing it against a list of the actual prevalence data releases in the data/model directory.
  if (!modelVersions.includes(modelVersion as string)) {
    res.status(400).send({ error: `Invalid model release: ${modelVersion}` });
    return;
  }

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

const requestableSurveyProperties = [
  "study_label",
  "contributors",
  "reference",
  "reference_year",
  "survey_id",
  "site_name",
  "lat",
  "lng",
  "collection_start",
  "collection_end",
  "collection_day",
  "numerator",
  "denominator",
  "prevalence",
  "prevalence_lower",
  "prevalence_upper",
  "variant",
  "gene",
  "mutation",
]

app.get('/surveys', async (req: Request, res: Response) => {
  // TODO: type queryParams for this endpoint and validate all params (don't allow unrecognised params)
  const queryParams = req.query as Record<string, string | undefined>;
  if (!queryParams.data_release) {
    res.status(400).send({ error: "Missing required query parameter: data_release" });
    return;
  }

  // Security: Validate that the above is a filepath within the expected data directory,
  // by comparing it against a list of the actual survey data releases in the data/stave directory.
  if (!dataVersions.includes(queryParams.data_release)) {
    res.status(400).send({ error: `Invalid data release requested: ${queryParams.data_release}` });
    return;
  }

  ["date_from", "date_to"].forEach(param => {
    if (queryParams[param] && !dateRegex.test(queryParams[param]!)) {
      res.status(400).send({ error: `Invalid date format for parameter '${param}'. Expected YYYY-MM-DD.` });
      return;
    }
  });

  if (queryParams.admin0 && !/^[A-Z]{3}$/.test(queryParams.admin0)) {
    res.status(400).send({ error: "Invalid ISO code for parameter 'admin0'. Expected a 3-letter uppercase ISO code." });
    return;
  }

  if (queryParams.date_from && !queryParams.date_to) {
    res.status(400).send({ error: "Missing required parameter 'date_to' when 'date_from' is specified." });
    return;
  }

  if (queryParams.date_to && !queryParams.date_from) {
    res.status(400).send({ error: "Missing required parameter 'date_from' when 'date_to' is specified." });
    return;
  }

  if (queryParams.date_from && queryParams.date_to && new Date(queryParams.date_from) > new Date(queryParams.date_to)) {
    res.status(400).send({ error: "'date_from' cannot be later than 'date_to'." });
    return;
  }

  const surveyDataParquet = `data/stave/${queryParams.data_release}/survey_data.parquet`;

  const properties = queryParams.properties?.split(',') ?? [];
  if (properties.length === 0) {
    res.status(400).send({ error: "At least one property must be requested." });
    return;
  }

  const columnsInData = await connection.runAndReadAll(`SELECT * FROM '${surveyDataParquet}' LIMIT 1`);
  const availableColumns = columnsInData.columnNames(); // Conceivably will vary by data release if schema changes
  const columnTypes = columnsInData.columnTypes();
  const roundableColumns = availableColumns.filter((_col, index) => {
    return ["DOUBLE", "FLOAT", "DECIMAL"].includes(String(columnTypes[index]));
  });

  const invalid = properties.find(p => !requestableSurveyProperties.includes(p) || !availableColumns.includes(p));
  if (invalid) {
    res.status(400).send({ error: `Invalid property requested: ${invalid}` });
    return;
  }

  const selectableParams = ["admin0", "survey_id", "date_from", "date_to", "gene", "mutation"]
    .filter(param => !!queryParams[param]);
  const tableName = "c";
  const whereClauses = ["1 = 1"]; // Start with a dummy condition to simplify appending AND clauses
  selectableParams.forEach((param) => {
    if (param === "admin0") {
      const iso = queryParams[param]!;
      const region = admin0RegionMetadata.find(({ id }) => id === iso);
      if (!region) {
        res.status(400).send({ error: `ISO code not found: ${iso}` });
        return;
      }
      const bounds = region.bounds;

      whereClauses.push(
        `${tableName}.lat >= ${bounds.min.lat}`,
        `${tableName}.lat <= ${bounds.max.lat}`,
        `${tableName}.lng >= ${bounds.min.lng}`,
        `${tableName}.lng <= ${bounds.max.lng}`
      );
      return; 
    }
    const column = ["date_from", "date_to"].includes(param) ? "collection_day" : param;
    const equality = param === "date_from" ? ">=" : param === "date_to" ? "<=" : "=";

    whereClauses.push(`${tableName}.${column} ${equality} $${param}`);
  });

  const columns = properties.map((p) => {
    if (roundableColumns.includes(p)) {
      // Round to 4 decimal places for numeric columns, to reduce size of response
      return `ROUND(${tableName}.${p}, 4) AS ${p}`;
    }
    return `${tableName}.${p}`;
  }).join(", ");
  const statement = await connection.prepare(
    `SELECT ${columns} FROM '${surveyDataParquet}' ${tableName} WHERE ${whereClauses.join(' AND ')}`
  )
  const bindings = selectableParams.reduce((acc, param) => {
    if (param === "admin0") {
      // We use lat and lng instead of admin0 in the SQL query
      return acc
    }
    acc[param] = queryParams[param] ?? null;
    return acc;
  }, {} as Record<string, string | null>);
  statement.bind(bindings);
  const result = await statement.runAndReadAll();
  const rows = result.getRowObjectsJson();

  res.type("json").send(rows);
});

const requestablePrevalenceProperties = [
  "variant",
  "gene",
  "mutation",
  "admin0",
  "admin1",
  "admin2",
  "date",
  "mean",
  "median",
  "SD",
  "lower_95",
  "upper_95",
  "exceedance_1",
  "exceedance_2",
  "exceedance_5",
  "exceedance_10",
  "no_of_informing_surveys",
  "nearest_survey_by_date" // gives a survey_id
]

app.get('/prevalences', async (req: Request, res: Response) => {
  // TODO: type queryParams for this endpoint and validate all params (don't allow unrecognised params)
  const queryParams = req.query as Record<string, string | undefined>;

  const modelVersion = queryParams.model_release as string;
  if (!modelVersion) {
    res.status(400).send({ error: "Missing required query parameter: model_release" });
    return;
  }

  // Security: Validate that the above is a filepath within the expected data directory,
  // by comparing it against a list of the actual survey data releases in the data/stave directory.
  if (!modelVersions.includes(modelVersion)) {
    res.status(400).send({ error: `Invalid model release requested: ${modelVersion}` });
    return;
  }

  ["date", "date_from", "date_to"].forEach(param => {
    if (queryParams[param] && !dateRegex.test(queryParams[param]!)) {
      res.status(400).send({ error: `Invalid date format for parameter '${param}'. Expected YYYY-MM-DD.` });
      return;
    }
  });

  // Check the date is the first of a month
  if (queryParams.date && new Date(queryParams.date).getDate() !== 1) {
    res.status(400).send({ error: "Invalid `date` parameter. The date must be the first of a month." });
    return;
  }

  if (queryParams.admin0 && !/^[A-Z]{3}$/.test(queryParams.admin0)) {
    res.status(400).send({ error: "Invalid ISO code for parameter 'admin0'. Expected a 3-letter uppercase ISO code." });
    return;
  }

  if (queryParams.date_from && !queryParams.date_to) {
    res.status(400).send({ error: "Missing required parameter 'date_to' when 'date_from' is specified." });
    return;
  }

  if (queryParams.date_to && !queryParams.date_from) {
    res.status(400).send({ error: "Missing required parameter 'date_from' when 'date_to' is specified." });
    return;
  }

  if (queryParams.date_from && queryParams.date_to && new Date(queryParams.date_from) > new Date(queryParams.date_to)) {
    res.status(400).send({ error: "'date_from' cannot be later than 'date_to'." });
    return;
  }

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

  const columnsInData = await connection.runAndReadAll(`SELECT * FROM '${prevalencesParquet}' LIMIT 1`);
  const availableColumns = columnsInData.columnNames(); // Conceivably will vary by model release if schema changes
  const columnTypes = columnsInData.columnTypes();
  const roundableColumns = availableColumns.filter((_col, index) => {
    return ["DOUBLE", "FLOAT", "DECIMAL"].includes(String(columnTypes[index]));
  });

  adminLevels.forEach((level) => {
    if (queryParams[`admin${level}`] && adminLevel < level) {
      res.status(400).send({ error: "You cannot request results at a less granular level than that of the containing region." })
    }
  })

  const properties = queryParams.properties?.split(',').filter(p => !!p) ?? [];
  if (properties.length === 0) {
    res.status(400).send({ error: "At least one property must be requested." });
    return;
  }

  const invalid = properties.find(p => !requestablePrevalenceProperties.includes(p) || !availableColumns.includes(p));
  if (invalid) {
    res.status(400).send({ error: `Invalid property requested: ${invalid}` });
    return;
  }

  const selectableParams = ["admin0", "admin1", "admin2", "gene", "mutation", "date", "date_from", "date_to"]
    .filter(param => !!queryParams[param]);
  const tableName = "p";
  const whereClauses = ["1 = 1"]; // Start with a dummy condition to simplify appending AND clauses
  selectableParams.forEach((param) => {
    const column = ["date_from", "date_to"].includes(param) ? "date" : param;
    const equality = param === "date_from" ? ">=" : param === "date_to" ? "<=" : "=";

    whereClauses.push(`${tableName}.${column} ${equality} $${param}`);
    return;
  });

  const columns = properties.map((p) => {
    if (roundableColumns.includes(p)) {
      // Round to 4 decimal places for numeric columns, to reduce size of response
      return `ROUND(${tableName}.${p}, 4) AS ${p}`;
    }
    return `${tableName}.${p}`;
  }).join(", ");

  const statement = await connection.prepare(
    `SELECT ${columns} FROM '${prevalencesParquet}' ${tableName} WHERE ${whereClauses.join(' AND ')}`
  )
  const bindings = selectableParams.reduce((acc, param) => {
    acc[param] = queryParams[param] ?? null;
    return acc;
  }, {} as Record<string, string | null>);
  statement.bind(bindings);
  const result = await statement.runAndReadAll();
  const cols = result.getColumnsObjectJson();

  res.type("json").send(cols);
});

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
