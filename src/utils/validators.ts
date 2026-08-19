import { type Request, type Response } from 'express';
import { LATEST_MODEL_VERSION, modelVersions, dataVersions, dateRegex } from '../constants.ts';

export const validateModelRelease = (req: Request, res: Response): string | null => {
  const modelVersion = req.query['model_release'] ?? LATEST_MODEL_VERSION;

  // Security against SQL injection: Validate that the above is a filepath within the expected data directory,
  // by comparing it against a list of the actual prevalence data releases in the data/model directory.
  if (!modelVersions.includes(modelVersion as string)) {
    res.status(400).send({ error: `Invalid model release: ${modelVersion}` });
    return null;
  }
  return modelVersion as string;
};

export const validateDataRelease = (req: Request, res: Response): string | null => {
  const dataVersion = req.query['data_release'];

  // Security against SQL injection: Validate that the above is a filepath within the expected data directory,
  // by comparing it against a list of the actual survey data releases in the data/stave directory.
  if (!dataVersions.includes(dataVersion as string)) {
    res.status(400).send({ error: `Invalid data release requested: ${dataVersion}` });
    return null;
  }
  return dataVersion as string;
};

export const validateDateParams = (
  req: Request,
  res: Response,
): {
  date_from: string | undefined;
  date_to: string | undefined;
  date: string | undefined;
} | null => {
  const queryParams = req.query as Record<string, string | undefined>;
  const date = queryParams.date;
  const date_from = queryParams.date_from;
  const date_to = queryParams.date_to;

  ["date", "date_from", "date_to"].forEach(param => {
    if (queryParams[param] && !dateRegex.test(queryParams[param]!)) {
      res.status(400).send({ error: `Invalid date format for parameter '${param}'. Expected YYYY-MM-DD.` });
      return null;
    }
  });

  if (date_from && !date_to) {
    res.status(400).send({ error: "Missing required parameter 'date_to' when 'date_from' is specified." });
    return null;
  }

  if (date_to && !date_from) {
    res.status(400).send({ error: "Missing required parameter 'date_from' when 'date_to' is specified." });
    return null;
  }

  if (date_from && date_to && new Date(date_from) > new Date(date_to)) {
    res.status(400).send({ error: "'date_from' cannot be later than 'date_to'." });
    return null;
  }
  return { date_from, date_to, date };
};

export const validateAdmin0 = (req: Request, res: Response): string | null => {
  const admin0 = req.query['admin0'];

  if (admin0 && !/^[A-Z]{3}$/.test(admin0 as string)) {
    res.status(400).send({ error: "Invalid ISO code for parameter 'admin0'. Expected a 3-letter uppercase ISO code." });
    return null;
  }
  return admin0 as string;
};
