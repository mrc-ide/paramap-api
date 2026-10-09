import { type Response } from 'express';

export const sendErrorResponse = (res: Response, error: string, status: number) => {
  res.status(status).send({ error });
};