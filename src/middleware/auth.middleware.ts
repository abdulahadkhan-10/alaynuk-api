import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { prisma } from '../config/prisma';

export interface UserPayload {
  id: string;
  email: string;
  role: 'SUPER_ADMIN' | 'BUSINESS_OWNER' | 'MANAGER' | 'STAFF' | 'KITCHEN' | 'SUPPLIER';
  name: string;
  businessId?: string | null;
  supplierId?: string | null;
  phoneNo?: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: UserPayload;
  outletId?: string;
  businessId?: string;
}

// Extend Express Request interface globally
declare global {
  namespace Express {
    interface Request {
      user?: UserPayload;
      outletId?: string;
      businessId?: string;
    }
  }
}

/**
 * Access tokens are short-lived but stateless, so a deactivated/removed account would otherwise keep
 * working until its token expires. This lookup (by primary key) cuts access off immediately.
 */
async function isAccountActive(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, deletedAt: true },
  });
  return !!user && user.isActive && !user.deletedAt;
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const portalHeader = (req.headers['x-portal'] as string)?.toLowerCase();
  const originHeader = (req.headers.origin || req.headers.referer || '') as string;
  
  const isAdminRequest =
    portalHeader === 'admin' ||
    req.baseUrl?.startsWith('/api/v1/admin') ||
    req.originalUrl?.includes('/api/v1/admin') ||
    originHeader.includes('admin');

  let token: string | undefined;

  if (isAdminRequest) {
    token = req.cookies?.alayn_admin_token || req.cookies?.token;
  } else {
    token = req.cookies?.token;
  }

  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
  }

  if (!token) {
    return next(new AppError('UNAUTHORIZED', 'No authentication token provided', 401));
  }

  let decoded: UserPayload;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET) as UserPayload;
  } catch (error) {
    return next(new AppError('UNAUTHORIZED', 'Invalid or expired token', 401));
  }

  try {
    if (!(await isAccountActive(decoded.id))) {
      return next(new AppError('ACCOUNT_DISABLED', 'Your account has been deactivated. Please contact your manager.', 401));
    }
  } catch (error) {
    return next(error);
  }

  req.user = decoded;
  if (decoded.businessId) {
    req.businessId = decoded.businessId;
  }
  next();
}

export default authMiddleware;
