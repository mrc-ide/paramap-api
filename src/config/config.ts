import dotenv from 'dotenv';

dotenv.config();

interface Config {
  port: number;
  nodeEnv: string;
}

const port = process.env.PORT;
if (!port) throw new Error('PORT is required');

const config: Config = {
  port: Number(port),
  nodeEnv: process.env.NODE_ENV || 'development',
};

export default config;
