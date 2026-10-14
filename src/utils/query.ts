import type { Query } from 'express-serve-static-core';
import { AppError } from '../middlewares/errorHandler.ts';

export const getQueryParamStr = (query: Query, param: string) => {
  const val = query[param];
  const isList = Array.isArray(val) || (typeof val === 'string' && val.split(',').length > 1)
  if (isList || typeof val === 'object') {
    throw new AppError(`Query parameter "${param}" must be a single string`, 400);
  }

  return val as string;
};

export const getQueryParamArr = (query: Query, param: string) => {
  const val = query[param];
  if (typeof val === 'string') return val.split(',');
  if (Array.isArray(val) && val.every((item) => typeof item === 'string')) return val;

  throw new AppError(`Query parameter "${param}" must be an array of strings`, 400);
};