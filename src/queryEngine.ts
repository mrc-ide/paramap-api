import { DuckDBInstance } from '@duckdb/node-api';

// Create DuckDB instance in persistent mode so that we can
// use the READ_ONLY setting (not available in in-memory mode).

// Both persistent and in-memory mode use spilling to disk to facilitate
// larger-than-memory workloads (i.e., out-of-core-processing).

// 'dummy.db' will not be used, but it is required to pass in
// a db file name when creating an instance in persistent mode.
const instance = await DuckDBInstance.create('dummy.db', {
  parquet_metadata_cache: "true",
  access_mode: 'READ_ONLY',
});

export const connection = await instance.connect();
