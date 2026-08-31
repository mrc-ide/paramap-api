import dotenv from 'dotenv';

dotenv.config();

interface Config {
  port?: number;
  dataDir: string;
  latestModelVersion: string;
}

const port = process.env.PORT;

const config: Config = {
  port: port ? Number(port) : undefined,
  dataDir: process.env.NODE_ENV === 'test'
    ? 'tests/fixtures/data'
    : 'data',
  latestModelVersion: '2026.05.08',
};

export default config;
