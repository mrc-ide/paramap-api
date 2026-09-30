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
  latestModelVersion: 'v0.1.0',
};

export default config;
