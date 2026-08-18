import { type Request, type Response, type NextFunction } from 'express';

export const requestTimingLogger = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const startTime = performance.now();
  let logged = false;

  const logDuration = (event: 'finish' | 'close') => {
    if (logged) {
      return;
    }
    logged = true;

    const durationMs = performance.now() - startTime;
    console.log('[req-timing]', {
      method: req.method,
      path: req.path,
      query: req.query,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      event,
    });
  };

  res.once('finish', () => logDuration('finish'));
  res.once('close', () => logDuration('close'));

  next();
};
