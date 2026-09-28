import { createApp } from './app.ts';
import config from './config/config.ts';

if (!config.port) {
  throw new Error('PORT is required');
}

const app = createApp();

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
