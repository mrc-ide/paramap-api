import type { Query } from 'express-serve-static-core';
import type { Response } from 'express';
import { sendErrorResponse } from './helpers.ts';

export const getQueryParamStr = (res: Response, query: Query, param: string) => {
  const val = query[param];
  const isList = Array.isArray(val) || (typeof val === 'string' && val.split(',').length > 1)
  if (isList || typeof val === 'object') {
    sendErrorResponse(res, `Query parameter "${param}" must be a single string`, 400);
    return;
  }
  return val as string;
};

export const getQueryParamArr = (res: Response, query: Query, param: string) => {
  const val = query[param];
  if (typeof val === 'string') return val.split(',');
  if (Array.isArray(val) && val.every((item) => typeof item === 'string')) return val;

  sendErrorResponse(res, `Query parameter "${param}" must be an array`, 400);
  return;
};