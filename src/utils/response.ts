import { Response } from 'express';

export function sendSuccess(res: Response, data: any, statusCode: number = 200) {
  return res.status(statusCode).json({
    success: true,
    data,
  });
}

export interface PaginationMeta {
  limit: number;
  offset: number;
  total: number;
}

export function sendList(res: Response, data: any[], meta: PaginationMeta, statusCode: number = 200) {
  return res.status(statusCode).json({
    success: true,
    data,
    meta,
  });
}

export function sendError(res: Response, code: string, message: string, statusCode: number = 400) {
  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
    },
  });
}
