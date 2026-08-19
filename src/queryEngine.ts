import { DuckDBInstance } from '@duckdb/node-api';

// On creating with in-memory database: https://duckdb.org/docs/current/clients/node_neo/overview#create-instance
// DuckDB can operate in both persistent mode, where the data is saved to disk, and in in-memory mode, where the entire dataset is stored in the main memory.
// Both persistent and in-memory databases use spilling to disk to facilitate larger-than-memory workloads (i.e., out-of-core-processing).
// In in-memory mode, no data is persisted to disk, therefore, all data is lost when the process finishes.

// We can do partial resolution of queries using streaming, see https://duckdb.org/docs/current/clients/node_neo

const instance = await DuckDBInstance.create(':memory:', {
  parquet_metadata_cache: "true",
});

export const connection = await instance.connect();
