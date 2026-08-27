import dotenv from 'dotenv';

dotenv.config();

interface Config {
  port?: number;
  nodeEnv: string;
  dataDir: string;
  latestModelVersion: string;
}

const port = process.env.PORT;
const nodeEnv = process.env.NODE_ENV || 'development';

const config: Config = {
  port: port ? Number(port) : undefined,
  nodeEnv,
  dataDir: nodeEnv === 'test' ? 'tests/fixtures/data' : 'data',
  latestModelVersion: '2026.05.08',
};

export default config;
