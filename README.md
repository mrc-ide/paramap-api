# PARAmap API

This repo will contain an API serving two kinds of data to be rendered by PARAmap:

1) data points of surveys of genetic markers, which come to us stored in the [STAVE](https://mrc-ide.github.io/STAVE/index.html) schema;
2) and a surface of model outputs  imputed from the survey data, which are essentially interpolated prevalences of the difference genetic markers per region.

## How to update the data

### Model outputs

TODO

The list of in-scope genes and mutations will vary over time, with model releases (rather than with STAVE data releases). Every model release has a dependency on one STAVE data release.

### STAVE data

When a new STAVE data release is provided, it should be given a version name e.g. "2026.03.17", and committed in `scripts/input/stave/<version>/stave_data.rds`. Then, run the [process_stave.R](./scripts/process_stave.R) script:

```sh
Rscript ./scripts/process_stave.R 2026.03.17
```

This will create `./data/stave/<version>/survey_data.parquet`.
