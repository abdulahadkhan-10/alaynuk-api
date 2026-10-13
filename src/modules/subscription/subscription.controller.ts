import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth.middleware';
import { SubscriptionService } from './subscription.service';
import { sendSuccess } from '../../utils/response';
import { AppError } from '../../utils/AppError';

export class SubscriptionController {
  private service = new SubscriptionService();

  getPlans = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const plans = this.service.getPlans();
      return sendSuccess(res, plans);
    } catch (error) {
      next(error);
    }
  };

  initiateOutletCheckout = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const businessId = req.user?.businessId;
      const userId = req.user?.id;

      if (!businessId || !userId) {
        throw new AppError('UNAUTHORIZED', 'User not associated with a business', 401);
      }

      const { outletId, planCode, months, couponCode } = req.body;
      if (!outletId) {
        throw new AppError('VALIDATION_ERROR', 'Outlet ID is required to initiate subscription', 400);
      }

      const parsedMonths = months ? Math.max(1, Math.min(36, parseInt(months, 10) || 1)) : 1;

      const customerInfo = {
        name: req.user?.name,
        email: req.user?.email,
        phone: req.user?.phoneNo ?? undefined
      };

      const result = await this.service.initiateOutletSubscription(
        businessId,
        userId,
        outletId,
        planCode || 'MONTHLY_STANDARD',
        customerInfo,
        parsedMonths,
        couponCode
      );

      return sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  };

  verifyOutletPayment = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { orderId } = req.body;
      if (!orderId) {
        throw new AppError('VALIDATION_ERROR', 'Cashfree Order ID is required for verification', 400);
      }

      const result = await this.service.verifyOutletPayment(orderId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  getOutletSubscriptionStatus = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { outletId } = req.params;
      if (!outletId) {
        throw new AppError('VALIDATION_ERROR', 'Outlet ID is required', 400);
      }

      const result = await this.service.getOutletSubscriptionStatus(outletId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  getBillingHistory = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const businessId = req.user?.businessId;
      if (!businessId) {
        throw new AppError('UNAUTHORIZED', 'Business context required', 401);
      }

      const result = await this.service.getBillingHistory(businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  validateCoupon = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const code = String(req.query.code || req.body?.code || '');
      const businessId = (req as any).user?.businessId || (req.query.businessId as string);
      const result = await this.service.validateCoupon(code, businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  applyCoupon = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const businessId = req.user?.businessId;
      if (!businessId) {
        throw new AppError('UNAUTHORIZED', 'Business context required', 401);
      }

      const { couponCode, outletId } = req.body;
      if (!couponCode) {
        throw new AppError('VALIDATION_ERROR', 'Coupon code is required', 400);
      }

      const result = await this.service.applyCoupon(businessId, couponCode, outletId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  handleWebhook = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawBody = (req as any).rawBody || JSON.stringify(req.body);
      const headers = req.headers;
      const payload = req.body;

      const result = await this.service.handleCashfreeWebhook(rawBody, headers, payload);
      return res.status(200).json({ status: 'OK', result });
    } catch (error) {
      console.error('[SubscriptionController Webhook Error]:', error);
      next(error);
    }
  };
}
export default SubscriptionController;
