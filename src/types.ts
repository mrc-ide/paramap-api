export interface Mutation {
  mutation: string;
  date_range: {
    start: string;
    end: string;
  };
}

export type QueryParams = Record<string, string | undefined>;

export const metadataQueryParams = {} as QueryParams;
