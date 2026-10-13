import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { OrderController } from './order.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { businessMiddleware } from '../../middleware/business.middleware';
import { authorize } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validate.middleware';
import { createOrderSchema, updateOrderStatusSchema, createPaymentSchema, serviceChargeWaiverSchema } from './order.schema';
import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';

// Stricter rate limits for QR interactions
const qrLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many QR requests. Please try again later.',
    },
  },
});

const router = Router();
const controller = new OrderController();

// Flexible auth middleware for ordering:
// If request has logged-in user session (cookie/auth header), run standard auth.
// Otherwise, check if request is customer QR order with tableToken.
async function flexibleOrderAuth(req: Request, res: Response, next: NextFunction) {
  const hasToken = req.cookies?.token || req.cookies?.accessToken || req.headers.authorization || req.headers.cookie;
  if (hasToken) {
    return authMiddleware(req, res, (err) => {
      if (err) {
        // If cookie/token was missing/invalid but tableToken exists, fall back to QR token
        if (req.body && req.body.source === 'QR' && req.body.tableToken) {
          return processTableTokenAuth(req, res, next);
        }
        return next(err);
      }
      return businessMiddleware(req, res, next);
    });
  }

  // QR order customer access fallback
  if (req.body && req.body.source === 'QR' && req.body.tableToken) {
    return processTableTokenAuth(req, res, next);
  }

  return next(new AppError('UNAUTHORIZED', 'Authentication token or Table token is required', 401));
}

async function processTableTokenAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const tokenRecord = await prisma.tableToken.findUnique({
      where: { token: req.body.tableToken },
    });
    if (!tokenRecord) {
      return next(new AppError('INVALID_TOKEN', 'Table token is invalid', 400));
    }
    if (new Date() > tokenRecord.expiresAt) {
      return next(new AppError('EXPIRED_TOKEN', 'Table token has expired', 400));
    }
    req.outletId = tokenRecord.outletId;
    req.user = {
      id: '00000000-0000-0000-0000-000000000000', // customer placeholder
      email: 'customer@table.com',
      role: 'STAFF', // Allowed to create orders
      name: `Table ${tokenRecord.tableNumber} Customer`,
    };
    return next();
  } catch (err) {
    return next(err);
  }
}

// 1. Public Table Menu fetching (no user auth, rate-limited)
router.get('/tables/:token/menu', qrLimiter, controller.getTableMenu);

// 2. Order placement (requires flexible auth: employee or valid table token)
router.post('/', flexibleOrderAuth, validate({ body: createOrderSchema }), controller.create);

// 3. Management routes (require full user auth)
router.get('/', authMiddleware, businessMiddleware, authorize('BUSINESS_OWNER', 'MANAGER', 'STAFF', 'KITCHEN'), controller.getAll);
router.patch('/:id/status', authMiddleware, businessMiddleware, authorize('BUSINESS_OWNER', 'MANAGER', 'STAFF', 'KITCHEN'), validate({ body: updateOrderStatusSchema }), controller.updateStatus);
router.post('/:id/payments', authMiddleware, businessMiddleware, authorize('BUSINESS_OWNER', 'MANAGER', 'STAFF'), validate({ body: createPaymentSchema }), controller.createPayment);
// Customer asked to remove (or restore) the voluntary service charge — recorded with who/why
router.patch('/:id/service-charge', authMiddleware, businessMiddleware, authorize('BUSINESS_OWNER', 'MANAGER', 'STAFF'), validate({ body: serviceChargeWaiverSchema }), controller.setServiceChargeWaiver);

// Kitchen orders router
const kitchenRouter = Router();
kitchenRouter.use(authMiddleware);
kitchenRouter.use(businessMiddleware);
kitchenRouter.get('/orders', authorize('BUSINESS_OWNER', 'MANAGER', 'STAFF', 'KITCHEN'), controller.getKitchenOrders);
kitchenRouter.get('/tickets', authorize('BUSINESS_OWNER', 'MANAGER', 'STAFF', 'KITCHEN'), controller.getKitchenOrders);

export { kitchenRouter };
export default router;
