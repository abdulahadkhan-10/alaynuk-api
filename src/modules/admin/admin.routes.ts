import { Router } from 'express';
import { AdminController } from './admin.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { authorize } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  createCouponSchema,
  updateCouponSchema,
  getCouponsQuerySchema,
  getOutletsQuerySchema,
} from './admin.schema';

const router = Router();
const controller = new AdminController();

// Strictly protect all admin routes with authentication and SUPER_ADMIN RBAC
router.use(authMiddleware);
router.use(authorize('SUPER_ADMIN'));

// Platform Dashboard Metrics
router.get('/dashboard', controller.getDashboard);

// Outlets & Branches Management
router.get('/outlets', validate({ query: getOutletsQuerySchema }), controller.getOutlets);
router.get('/outlets/:id', controller.getOutletDetails);

// Coupon Management Suite
router.get('/coupons', validate({ query: getCouponsQuerySchema }), controller.getCoupons);
router.post('/coupons', validate({ body: createCouponSchema }), controller.createCoupon);
router.patch('/coupons/:id', validate({ body: updateCouponSchema }), controller.updateCoupon);
router.delete('/coupons/:id', controller.deleteCoupon);

export default router;
