import { Request } from 'express';

export function getPaginationParams(req: Request) {
  const limitQuery = parseInt(req.query.limit as string, 10);
  const offsetQuery = parseInt(req.query.offset as string, 10);

  const limit = isNaN(limitQuery) ? 20 : Math.min(Math.max(limitQuery, 1), 1000);
  const offset = isNaN(offsetQuery) ? 0 : Math.max(offsetQuery, 0);

  return { limit, offset };
}
