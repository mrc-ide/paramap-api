import { connection } from "../queryEngine.ts";
import type { Mutation } from "../types.ts";
import { PREVALENCE_COLUMNS } from "../constants.ts";
import { admin0RegionMetadata, prevalencesParquet, type Bounds } from "./data.ts";

// Get unique genetic variants and their associated genes and mutations,
// as well as the date range for each variant, from the model outputs rectangle.
export const getMutationsByGene = async (
  modelVersion: string,
): Promise<{
  gene: string,
  mutations: Mutation[],
}[]> => {
  // The 'variant' column encodes both the gene and mutation, so we can
  // group by that column to get unique variants.
  const uniqueVariants = await connection.runAndReadAll(`
    SELECT
      ANY_VALUE(gene) AS gene,
      ANY_VALUE(mutation) AS mutation,
      variant,
      MIN("date") AS min_date,
      MAX("date") AS max_date
    FROM '${prevalencesParquet(modelVersion, "0")}'
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

// Get the bounding box enclosing all admin0 regions for a model release.
export const globalBounds = async (modelVersion: string): Promise<Bounds> => {
  const uniqueAdmin0Query = await connection.runAndReadAll(`
    SELECT DISTINCT ${PREVALENCE_COLUMNS.ADMIN0}
    FROM '${prevalencesParquet(modelVersion, "0")}'
  `);
  const admin0s = new Set(uniqueAdmin0Query.getColumnsObject()[PREVALENCE_COLUMNS.ADMIN0]);

  return admin0RegionMetadata
    .filter(({ id }) => admin0s.has(id))
    .reduce((acc, { bounds }) => {
      return {
        min: {
          lat: Math.min(acc.min.lat, bounds.min.lat),
          lng: Math.min(acc.min.lng, bounds.min.lng),
        },
        max: {
          lat: Math.max(acc.max.lat, bounds.max.lat),
          lng: Math.max(acc.max.lng, bounds.max.lng),
        },
      };
    }, { min: { lat: Infinity, lng: Infinity }, max: { lat: -Infinity, lng: -Infinity } });
};
