# Test strategy

Run all tests with `npm test`, or use `npm run test:watch` while developing.

## Unit tests

- Test validation branches directly with small request/response stubs.
- Test data and metadata helpers through their public functions.
- Mock DuckDB only to inspect SQL and bindings sent to it. Do not assert that invented
  mock database responses are correct.
- Do not export private implementation details solely for testing.

## Integration tests

Integration tests use supertest to exercise Express, validation, query construction,
real DuckDB, and tiny committed parquet fixtures together. They cover representative
request shapes for `/metadata`, `/prevalences`, and `/surveys`.

The fixtures live under `tests/fixtures/data`; tests and CI never read the application
datasets under `data`, which are gitignored and can be several gigabytes.

`npm run generate-test-fixtures` is a maintainer command that does require those source
datasets locally. It copies filtered, real-data parquet slices while preserving their
schemas. The selected model release is the single `MODEL_RELEASE` constant in
`tests/generate-test-fixtures.ts`; its data release is read from model metadata.
Generation validates the configured date windows and writes a temporary fixture set
before replacing the existing one.

The generated `fixture-config.json` supplies release identities and slice details to the
tests. The fixture release can differ from the application's production latest release.

## Keeping the suite focused

Add one unit test for each genuinely new validation or SQL-building branch. Add one
integration happy path for each new request shape, but do not repeat every validator
failure through every endpoint.
