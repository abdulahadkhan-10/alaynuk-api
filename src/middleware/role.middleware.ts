import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';

export function authorize(...allowedRoles: ('SUPER_ADMIN' | 'BUSINESS_OWNER' | 'MANAGER' | 'STAFF' | 'KITCHEN' | 'SUPPLIER')[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('UNAUTHORIZED', 'Authentication required', 401));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError('FORBIDDEN', 'Access denied: insufficient permissions', 403));
    }

    next();
  };
}

export default authorize;
