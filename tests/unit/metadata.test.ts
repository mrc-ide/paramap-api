import { describe, expect, it, vi } from 'vitest';
import { getMutationsByGene } from '../../src/utils/metadata.ts';
import fixtureConfig from '../fixtures/fixture-config.json' with { type: 'json' };

const runAndReadAll = vi.hoisted(() => vi.fn());

vi.mock('../../src/queryEngine.ts', () => {
  runAndReadAll.mockImplementation(() => ({
    getRowObjects: () => [
      {
        gene: 'crt',
        mutation: '76K',
        variant: 'crt:76:K',
        min_date: '2003-05-01',
        max_date: '2025-05-01',
      },
      {
        gene: 'k13',
        mutation: '469Y',
        variant: 'k13:469:Y',
        min_date: '2020-05-01',
        max_date: '2024-05-01',
      },
      {
        gene: 'k13',
        mutation: '469F',
        variant: 'k13:469:F',
        min_date: '2021-05-01',
        max_date: '2023-05-01',
      },
    ],
  }));
  
  return { connection: { runAndReadAll } };
});

describe('getMutationsByGene', () => {
  it('queries the parquet and groups mutations by gene', async () => {
    const result = await getMutationsByGene(fixtureConfig.modelRelease);

    expect(runAndReadAll).toHaveBeenCalledOnce();
    const sql = runAndReadAll.mock.calls[0][0] as string;
    expect(sql).toContain(
      `FROM 'tests/fixtures/data/model/${fixtureConfig.modelRelease}/admin0.parquet'`,
    );
    expect(result).toEqual([
      {
        gene: 'crt',
        mutations: [{
          mutation: '76K',
          date_range: { start: '2003-05-01', end: '2025-05-01' },
        }],
      },
      {
        gene: 'k13',
        mutations: [
          {
            mutation: '469Y',
            date_range: { start: '2020-05-01', end: '2024-05-01' },
          },
          {
            mutation: '469F',
            date_range: { start: '2021-05-01', end: '2023-05-01' },
          },
        ],
      },
    ]);
  });
});
