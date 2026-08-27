// Get unique genetic variants and their associated genes and mutations.

import { connection } from "../queryEngine.ts";
import { join } from "node:path";
import config from "../config/config.ts";
import type { Mutation } from "../types.ts";

// Get unique genetic variants and their associated genes and mutations,
// as well as the date range for each variant, from the model outputs rectangle.
export const getMutationsByGene = async (
  modelVersion: string,
): Promise<{
  gene: string,
  mutations: Mutation[],
}[]> => {
  const prevalencePath = join(config.dataDir, "model", modelVersion, "admin0.parquet");
  // The 'variant' column encodes both the gene and mutation, so we can
  // group by that column to get unique variants, and then extract the gene and mutation from that.
  const uniqueVariants = await connection.runAndReadAll(`
    SELECT
      ANY_VALUE(gene) AS gene,
      ANY_VALUE(mutation) AS mutation,
      variant,
      STRFTIME(MIN("date"), '%Y-%m-%d') AS min_date,
      STRFTIME(MAX("date"), '%Y-%m-%d') AS max_date
    FROM '${prevalencePath}'
    GROUP BY variant
  `);

  // Group the unique variants by gene, so that we can return a list of mutations
  // for each gene in the metadata endpoint.
  // We assume the date range per variant will be the same across all admin levels.
  return uniqueVariants.getRowObjects().reduce((acc, row) => {
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
};
