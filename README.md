# PARAmap API

This repo contains an API serving two kinds of data to be rendered by PARAmap:

1) data points of surveys of genetic markers, which come to us stored in the [STAVE](https://mrc-ide.github.io/STAVE/index.html) schema;
2) and a surface of model outputs imputed from the survey data, which are essentially interpolated prevalences of the different genetic markers per region. These are provided at three levels of granularity: admin levels 0, 1, and 2.

In general, when new releases of model outputs or of survey data are created, this is treated additively: that is, we will intentionally keep around older versions. These may be requested using query parameters `model_release`/`data_release`. Each model release has a dependency on a specific data release. 

## Endpoints

There are three endpoints, all read-only, which provide customisable slices of the data, which is read from parquet files.

The `/surveys` and `/prevalences` endpoints correspond to the two kinds of data referred to above. They share a common request format* whereby the query parameter `properties` specifies which parquet columns should be returned per entry, while several other query parameters are used to filter the data. To a first approximation, this is translated into an SQL query of the form `SELECT <properties> FROM <parquet file> WHERE <filters>`, though not all filters are expressible as `WHERE` clauses (e.g. they may instead entail reading a different source parquet file). By the use of these query parameters, we enable clients to flexibly thin the response sizes to precisely those rows and columns that are required.

*This is controlled by the const `endpointConfigs` in `src/utils/endpoints.ts`. 

1. /metadata

This endpoint returns:
- All available model releases
- The global/initial bounding box for the map
- Metadata pertaining to a specific model release (this is specified by an optional `model_release` parameter, which defaults to latest, as configured via `config.ts`):
  - The model release label ('version')
  - The corresponding data release for the model release
  - The available genes for the model release, each with their available 'mutations' (encoding position and allele), and the range of dates for which prevalence is modelled for each mutation.

Example:

request:
`GET /metadata`

response:
```jsonc
{
  "model_releases": ["v1", "v2"],
  "prevalences": {
    "version": "v1",
    "data_release": "v1.0.0",
    "variants": [
      {
        "gene": "k13",
        "mutations": [
          {
            "mutation": "469Y",
            "date_range": {
              "start": "2004-05-01",
              "end": "2030-09-01",
            },
          },
          {
            "mutation": "469F",
            "date_range": {
              "start": "2004-05-01",
              "end": "2030-09-01",
            },
          },
        ],
      },
      {
        "gene": "crt",
        "mutations": [
          {
            "mutation": "76K",
            "date_range": {
              "start": "2004-05-01",
              "end": "2030-09-01",
            },
          },
        ],
      }
    ]
  },
  "bounds": {
    "min": {
      "lng": -70.0635,
      "lat": 12.4124
    },
    "max": {
      "lng": -69.8654,
      "lat": 12.624
    }
  },
}
```

2. /surveys

An endpoint for querying survey data, as stored in `/data/stave/<version>/survey_data.parquet`.

Note that this endpoint actually returns multiple entries per STAVE survey - that is, we have one entry per variant per STAVE survey. Thus these objects match the STAVE concept of a '[count](https://mrc-ide.github.io/STAVE/articles/howto_counts_table.html)' (which counts a particular mutation) a bit more closely than the concept of a '[survey](https://mrc-ide.github.io/STAVE/articles/howto_surveys_table.html)' (which would collect multiple genetic variants).

Example:

request:
```
GET /surveys?
  &data_release=v1.0.0
  &date_from=2010-01-01
  &date_to=2010-02-01
  &gene=k13
  &mutation=469Y
  &properties=survey_id,lat,lng,collection_day,denominator
```

response:
```jsonc
[
  {
    "survey_id": "Dama_2017_Bamako_2014",
    "lat": 12.612900,
    "lng": -8.13560,
    "collection_day": "2010-01-15",
    "denominator": 130,
  },
  // ...
]
```

3. /prevalences

An endpoint for querying model outputs, as stored in `/data/model/<version>/admin<level>.parquet`.

The `admin_level` query parameter determines the granularity of the model outputs, while the query parameters `admin0`, `admin1` and `admin2` scope the results to a particular region. Thus for example, to request results within the `admin0` region of Mali (`MLI`), at the finest level of granularity:

request:
```
GET /prevalences?
  &model_release=v2
  &admin_level=2
  &admin0=MLI
  &gene=k13
  &mutation=469Y
  &date=2024-05-01
  &properties=median,admin2
```

response:
```jsonc
[
  {
    "admin2": "MLI.1.1_1",
    "median": 0.76470588235
  },
  // ...
]
```


## First-time development set-up

1. Process STAVE data

```sh
Rscript ./scripts/process_stave.R 2026.03.17
```

2. Generate example model outputs

Currently, we generate example model outputs using a script. These example outputs are partly based on the (real) STAVE data.

```sh
Rscript scripts/create_example_model_outputs.R
```

3. Fetch admin0 region metadata from Grout

```sh
ts-node --esm scripts/fetch_admin0_region_metadata.ts
```

4. Optionally run tests

```sh
npm run test
```

5. Start the app

```sh
npm run dev
```

## How to update the data

NB The list of in-scope genes and mutations will vary over time, with model releases (rather than with STAVE data releases); thus it is not something to hard-code as a constant. Every model release has a dependency on one STAVE data release.

### STAVE data

When a new STAVE data release is provided, it should be given a version name e.g. "2026.03.17", and committed in `scripts/input/stave/<version>/stave_data.rds`. Then, run the [process_stave.R](./scripts/process_stave.R) script:

```sh
Rscript ./scripts/process_stave.R 2026.03.17
```

This will create `./data/stave/<version>/survey_data.parquet`.

### Model outputs

As mentioned above, early development has used example model outputs generated by a script. We will at some point have access to real model outputs. Once these are provided, we can get rid of the tooling that creates example model outputs. We may then still need to do some amount of transformation to wrangle the data into the preferred format or filetype; this transformation step should take the form of a new script, akin to `./scripts/process_stave.R`.

As things stand now, a file `./data/model/<version>/metadata.json` must be manually created, to document the dependency of the model outputs (example or real) on a particular STAVE release.

## Data schema details

### Genes and mutations

The [variantstring](https://github.com/mrc-ide/variantstring) format encodes genetic variants in three components: the gene, the locus (position), and the amino acid (sometimes written as "aa"). As far as the app is concerned, however, the variant is composed more simply of two parts: the gene (which exactly corresponds to the variantstring concept of a gene) and the mutation (which fuses the locus and amino acid. Technically we could be more accurate by calling this an 'allele' since 'mutation' implies deviation from a reference allele, and some of the variants are reference alleles). In pre-processing, derived columns for gene and mutation are appended to the STAVE data, to enable this data to be queried by variant.

### Dates

Model outputs ('prevalences') will be provided per-month, which we encode as the first of each month. Unlike prevalences, the dates of surveys are not snapped to the first of the month, but can be any day.
