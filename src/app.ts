import express, { type Express, type Request, type Response } from 'express';
import { readdir } from 'fs/promises';
import { DuckDBInstance, VARCHAR } from '@duckdb/node-api';
import config from './config/config.ts';
import { errorHandler } from './middlewares/errorHandler.ts';

// NB: date range will vary with the marker, so maybe these date ranges needn't be in metadata... why were they there anyway?

const latestModelVersion = "2026.05.08";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

// Request grout to get bounding boxes for admin0.
// TODO: fall back when grout is down
// TODO: use paramap dataset rather than gadm41?
const groutMetadata = `https://mrcdata.dide.ic.ac.uk/grout/region-metadata/gadm41/admin0`;
const admin0RegionMetadata = await fetch(groutMetadata).then(res => res.json()) as {
  id: string,
  bounds: { min: { lat: number, lng: number }, max: { lat: number, lng: number } },
}[];

const staveFiles = await readdir("data/stave", { withFileTypes: true });
const dataVersions = staveFiles
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);

const modelFiles = await readdir("data/model", { withFileTypes: true });
const modelVersions = modelFiles
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);

// TODO: pre-calculate this from the in-scope countries, so it depends on model.
const globalBounds = {
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

const instance = await DuckDBInstance.create(':memory:', {
  parquet_metadata_cache: "true",
});
const connection = await instance.connect();

// Noting an assumption: the date range per variant will be the same across all admin levels.

interface Mutation {
  mutation: string;
  date_range: {
    start: string;
    end: string;
  };
}


// On creating with in-memory database: https://duckdb.org/docs/current/clients/node_neo/overview#create-instance
// DuckDB can operate in both persistent mode, where the data is saved to disk, and in in-memory mode, where the entire dataset is stored in the main memory.
// Both persistent and in-memory databases use spilling to disk to facilitate larger-than-memory workloads (i.e., out-of-core-processing).
// In in-memory mode, no data is persisted to disk, therefore, all data is lost when the process finishes.

// TODO: use duckdb read-only mode https://duckdb.org/docs/current/connect/concurrency
// This produces this error: "[Error: Catalog Error: Cannot launch in-memory database in read-only mode!]"

// We can do partial resolution of queries using streaming, see https://duckdb.org/docs/current/clients/node_neo

const app: Express = express();

// Can be called with or without a model_release parameter.
// If no model_release parameter, defaults to latest.
app.get('/metadata', async (req: Request, res: Response) => {
  const modelVersion = req.query['model_release'] ?? latestModelVersion;

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


// WHERE I GOT TO:
// surveys endpoint kind of works, but I need to test "is it performant when we request large amounts of data."
// same question for when I build the prevalences endpoint.
// can duckdb streaming help?

app.get('/surveys', async (req: Request, res: Response) => {
  const queryParams = req.query as Record<string, string | undefined>;
  if (!queryParams.data_release) {
    res.status(400).send({ error: "Missing required query parameter: data_release" });
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

  // Security: Validate that the above is a filepath within the expected data directory,
  // by comparing it against a list of the actual survey data releases in the data/stave directory.
  if (!dataVersions.includes(queryParams.data_release)) {
    res.status(400).send({ error: `Invalid data release requested: ${queryParams.data_release}` });
    return;
  }

  const properties = queryParams.properties?.split(',') ?? [];
  if (properties.length === 0) {
    res.status(400).send({ error: "At least one property must be requested." });
    return;
  }

  const columnsInData = await connection.runAndReadAll(`SELECT * FROM '${surveyDataParquet}' LIMIT 1`);
  const availableColumns = columnsInData.columnNames(); // Conceivably will vary by data release if schema changes

  if (!properties.every(p => requestableSurveyProperties.includes(p) && availableColumns.includes(p))) {
    const invalid = properties.find(p => !requestableSurveyProperties.includes(p) || !availableColumns.includes(p));
    res.status(400).send({ error: `Invalid property requested: ${invalid}` });
    return;
  }

  const selectableParams = ["admin0", "survey_id", "date_from", "date_to", "gene", "mutation"]
    .filter(param => !!queryParams[param]);
  const tableName = `c`;
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

  const columns = properties.map(p => `c.${p}`).join(", ");
  const statement = await connection.prepare(
    `SELECT ${columns} FROM '${surveyDataParquet}' ${tableName} WHERE ${whereClauses.join(' AND ')}`
  )
  const bindings = selectableParams.reduce((acc, param) => {
    acc[param] = queryParams[param] ?? null;
    return acc;
  }, {} as Record<string, string | null>);
  statement.bind(bindings, {
    survey_id: VARCHAR,
    date_from: VARCHAR,
    date_to: VARCHAR,
    gene: VARCHAR,
    mutation: VARCHAR,
  },
);
  const result = await statement.runAndReadAll();
  const rows = result.getRowObjectsJson();

  res.send(rows);
});

app.get('/prevalences', (req: Request, res: Response) => {
  const admin_level = req.query['admin_level'];

  res.send({admin_level_query_param: admin_level});
});

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
