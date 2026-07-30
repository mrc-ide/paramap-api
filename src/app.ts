import express, { type Express, type Request, type Response } from 'express';
import config from './config/config.ts';
import { errorHandler } from './middlewares/errorHandler.ts';

const app: Express = express();

app.get('/', (req: Request, res: Response) => {
  res.send({});
});

app.get('/prevalences', (req: Request, res: Response) => {
  const admin_level = req.query['admin_level'];

  res.send({admin_level_query_param: admin_level});
});

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
