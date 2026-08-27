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

The fixtures live under `tests/fixtures/data`; the application datasets under `data`
are not used because they are gitignored and can be several gigabytes. Regenerate the
fixtures with `npm run generate-test-fixtures`.

## Keeping the suite focused

Add one unit test for each genuinely new validation or SQL-building branch. Add one
integration happy path for each new request shape, but do not repeat every validator
failure through every endpoint.
