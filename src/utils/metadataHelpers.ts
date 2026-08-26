// Get unique genetic variants and their associated genes and mutations.

import { connection } from "../queryEngine.ts";
import type { Mutation } from "../types.ts";

export const getMutationsByGene = async (
  modelVersion: string,
): Promise<{
  gene: string,
  mutations: Mutation[],
}[]> => {
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
