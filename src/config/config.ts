import dotenv from 'dotenv';

dotenv.config();

interface Config {
  port?: number;
  nodeEnv: string;
  dataDir: string;
}

const port = process.env.PORT;
const nodeEnv = process.env.NODE_ENV || 'development';

const config: Config = {
  port: port ? Number(port) : undefined,
  nodeEnv,
  dataDir: nodeEnv === 'test' ? 'tests/fixtures/data' : 'data',
};

export default config;
